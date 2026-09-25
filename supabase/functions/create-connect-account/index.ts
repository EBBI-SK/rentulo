import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

type StripeV2AccountResponse = {
  id?: string;
  error?: { message?: string; type?: string; code?: string };
};

const denoRuntime = (globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }).Deno;
const STRIPE_V2_VERSION = "2026-08-26.dahlia";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

denoRuntime.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = denoRuntime.env.get("SUPABASE_URL");
  const anonKey = denoRuntime.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = denoRuntime.env.get("STRIPE_SECRET_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey) {
    console.error("create-connect-account: missing server configuration");
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse({ error: "Unauthorized" }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  const actor = userData.user;
  if (userError || !actor) return jsonResponse({ error: "Unauthorized" }, 401);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, full_name, email, stripe_connected_account_id, stripe_connect_status")
    .eq("id", actor.id)
    .single();

  if (profileError || !profile) {
    console.error("create-connect-account: profile lookup failed", profileError?.message || "missing profile");
    return jsonResponse({ error: "Profile not found" }, 404);
  }

  if (profile.stripe_connected_account_id) {
    return jsonResponse({ created: false, status: profile.stripe_connect_status || "onboarding" });
  }

  const contactEmail = String(actor.email || profile.email || "").trim();
  const displayName = String(profile.full_name || "").trim();

  const stripePayload = {
    contact_email: contactEmail || undefined,
    display_name: displayName || undefined,
    dashboard: "express",
    identity: {
      country: "CZ",
      entity_type: "individual",
    },
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: {
              requested: true,
            },
          },
        },
      },
    },
    defaults: {
      currency: "czk",
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application",
      },
    },
    metadata: {
      rentulo_user_id: actor.id,
    },
    include: ["configuration.recipient", "identity", "requirements", "defaults"],
  };

  const stripeResponse = await fetch("https://api.stripe.com/v2/core/accounts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/json",
      "Stripe-Version": STRIPE_V2_VERSION,
      "Idempotency-Key": `rentulo-connect-v2-account-${actor.id}`,
    },
    body: JSON.stringify(stripePayload),
  });

  const account = (await stripeResponse.json().catch(() => ({}))) as StripeV2AccountResponse;
  if (!stripeResponse.ok || !account.id) {
    console.error(
      "create-connect-account: Stripe v2 account creation failed",
      stripeResponse.status,
      account.error?.type || "unknown_error",
      account.error?.code || "unknown_code",
      account.error?.message || "",
    );
    return jsonResponse({ error: "Connected account could not be created" }, 502);
  }

  const now = new Date().toISOString();
  const update = await admin
    .from("profiles")
    .update({
      stripe_connected_account_id: account.id,
      stripe_connect_status: "onboarding",
      stripe_connect_details_submitted: false,
      stripe_connect_transfers_enabled: false,
      stripe_connect_updated_at: now,
      updated_at: now,
    })
    .eq("id", actor.id)
    .is("stripe_connected_account_id", null)
    .select("id")
    .maybeSingle();

  if (update.error) {
    console.error("create-connect-account: profile update failed", update.error.message);
    return jsonResponse({ error: "Connected account could not be saved" }, 500);
  }

  if (!update.data) {
    const concurrent = await admin
      .from("profiles")
      .select("stripe_connected_account_id, stripe_connect_status")
      .eq("id", actor.id)
      .single();

    if (concurrent.error || concurrent.data?.stripe_connected_account_id !== account.id) {
      console.error("create-connect-account: concurrent account mismatch");
      return jsonResponse({ error: "Connected account could not be saved" }, 409);
    }

    return jsonResponse({ created: false, status: concurrent.data.stripe_connect_status || "onboarding" });
  }

  return jsonResponse({ created: true, status: "onboarding" });
});
