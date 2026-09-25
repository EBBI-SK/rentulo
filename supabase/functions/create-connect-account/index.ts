import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

type StripeAccountResponse = {
  id?: string;
  details_submitted?: boolean;
  payouts_enabled?: boolean;
  capabilities?: { transfers?: string };
  requirements?: { disabled_reason?: string | null };
  error?: { message?: string; type?: string };
};

const denoRuntime = (globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }).Deno;

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

function connectStatus(account: StripeAccountResponse): "onboarding" | "restricted" | "ready" {
  const transfersEnabled = account.capabilities?.transfers === "active";
  if (account.details_submitted === true && transfersEnabled && account.payouts_enabled === true) {
    return "ready";
  }
  return account.requirements?.disabled_reason ? "restricted" : "onboarding";
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
    .select("id, email, stripe_connected_account_id, stripe_connect_status")
    .eq("id", actor.id)
    .single();

  if (profileError || !profile) {
    console.error("create-connect-account: profile lookup failed", profileError?.message || "missing profile");
    return jsonResponse({ error: "Profile not found" }, 404);
  }

  if (profile.stripe_connected_account_id) {
    return jsonResponse({ created: false, status: profile.stripe_connect_status || "onboarding" });
  }

  const params = new URLSearchParams();
  params.set("type", "express");
  params.set("country", "CZ");
  params.set("capabilities[transfers][requested]", "true");
  params.set("metadata[rentulo_user_id]", actor.id);
  if (actor.email || profile.email) params.set("email", actor.email || profile.email);

  const stripeResponse = await fetch("https://api.stripe.com/v1/accounts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `rentulo-connect-account-${actor.id}`,
    },
    body: params,
  });

  const account = (await stripeResponse.json().catch(() => ({}))) as StripeAccountResponse;
  if (!stripeResponse.ok || !account.id) {
    console.error(
      "create-connect-account: Stripe account creation failed",
      stripeResponse.status,
      account.error?.type || "unknown_error",
      account.error?.message || "",
    );
    return jsonResponse({ error: "Connected account could not be created" }, 502);
  }

  const status = connectStatus(account);
  const transfersEnabled = account.capabilities?.transfers === "active";
  const now = new Date().toISOString();

  const update = await admin
    .from("profiles")
    .update({
      stripe_connected_account_id: account.id,
      stripe_connect_status: status,
      stripe_connect_details_submitted: account.details_submitted === true,
      stripe_connect_transfers_enabled: transfersEnabled,
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

    return jsonResponse({ created: false, status: concurrent.data.stripe_connect_status || status });
  }

  return jsonResponse({ created: true, status });
});
