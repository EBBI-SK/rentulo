import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = { serve(handler: (request: Request) => Response | Promise<Response>): void; env: { get(name: string): string | undefined } };
type StripeAccountResponse = { id?: string; details_submitted?: boolean; payouts_enabled?: boolean; capabilities?: { transfers?: string }; requirements?: { disabled_reason?: string | null }; error?: { message?: string; type?: string } };
const denoRuntime = (globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }).Deno;
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
function jsonResponse(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
function statusFrom(account: StripeAccountResponse): "onboarding" | "restricted" | "ready" { const transfers = account.capabilities?.transfers === "active"; if (account.details_submitted === true && transfers && account.payouts_enabled === true) return "ready"; return account.requirements?.disabled_reason ? "restricted" : "onboarding"; }

denoRuntime.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const supabaseUrl = denoRuntime.env.get("SUPABASE_URL");
  const anonKey = denoRuntime.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = denoRuntime.env.get("STRIPE_SECRET_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey) return jsonResponse({ error: "Missing server configuration" }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return jsonResponse({ error: "Unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false } });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  const actor = userData.user;
  if (userError || !actor) return jsonResponse({ error: "Unauthorized" }, 401);

  const { data: profile, error: profileError } = await admin.from("profiles").select("stripe_connected_account_id").eq("id", actor.id).single();
  if (profileError || !profile) return jsonResponse({ error: "Profile not found" }, 404);
  if (!profile.stripe_connected_account_id) return jsonResponse({ status: "not_started", details_submitted: false, transfers_enabled: false });

  // Stripe supports using an Accounts v2 Account ID with v1 APIs. The v1 Account
  // representation remains useful here because it exposes details_submitted,
  // payouts_enabled and the transfers capability in one compatibility response.
  const stripeResponse = await fetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(profile.stripe_connected_account_id)}`, { headers: { Authorization: `Bearer ${stripeSecretKey}` } });
  const account = (await stripeResponse.json().catch(() => ({}))) as StripeAccountResponse;
  if (!stripeResponse.ok || account.id !== profile.stripe_connected_account_id) {
    console.error("get-connect-status: Stripe account lookup failed", stripeResponse.status, account.error?.type || "unknown_error", account.error?.message || "");
    return jsonResponse({ error: "Connected account status could not be loaded" }, 502);
  }

  const status = statusFrom(account);
  const detailsSubmitted = account.details_submitted === true;
  const transfersEnabled = account.capabilities?.transfers === "active";
  const now = new Date().toISOString();
  const { error: updateError } = await admin.from("profiles").update({ stripe_connect_status: status, stripe_connect_details_submitted: detailsSubmitted, stripe_connect_transfers_enabled: transfersEnabled, stripe_connect_updated_at: now, updated_at: now }).eq("id", actor.id).eq("stripe_connected_account_id", account.id);
  if (updateError) return jsonResponse({ error: "Connected account status could not be saved" }, 500);
  return jsonResponse({ status, details_submitted: detailsSubmitted, transfers_enabled: transfersEnabled });
});
