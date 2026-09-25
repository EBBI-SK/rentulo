import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = { serve(handler: (request: Request) => Response | Promise<Response>): void; env: { get(name: string): string | undefined } };
type StripeAccountLinkResponse = { url?: string; error?: { message?: string; type?: string } };
const denoRuntime = (globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }).Deno;
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
function jsonResponse(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
function normalizedSiteUrl(value: string): string | null { try { const parsed = new URL(value); if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null; return parsed.origin + parsed.pathname.replace(/\/$/, ""); } catch { return null; } }

denoRuntime.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const supabaseUrl = denoRuntime.env.get("SUPABASE_URL");
  const anonKey = denoRuntime.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = denoRuntime.env.get("STRIPE_SECRET_KEY");
  const siteUrl = normalizedSiteUrl(denoRuntime.env.get("SITE_URL") || "");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey || !siteUrl) return jsonResponse({ error: "Missing server configuration" }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return jsonResponse({ error: "Unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false } });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  const actor = userData.user;
  if (userError || !actor) return jsonResponse({ error: "Unauthorized" }, 401);

  const { data: profile, error: profileError } = await admin.from("profiles").select("stripe_connected_account_id").eq("id", actor.id).single();
  if (profileError || !profile?.stripe_connected_account_id) return jsonResponse({ error: "Connected account is not created" }, 409);

  const params = new URLSearchParams();
  params.set("account", profile.stripe_connected_account_id);
  params.set("refresh_url", `${siteUrl}/nastaveni.html?connect=refresh`);
  params.set("return_url", `${siteUrl}/nastaveni.html?connect=return`);
  params.set("type", "account_onboarding");

  const stripeResponse = await fetch("https://api.stripe.com/v1/account_links", { method: "POST", headers: { Authorization: `Bearer ${stripeSecretKey}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params });
  const link = (await stripeResponse.json().catch(() => ({}))) as StripeAccountLinkResponse;
  if (!stripeResponse.ok || !link.url) {
    console.error("create-connect-onboarding-link: Stripe rejected link creation", stripeResponse.status, link.error?.type || "unknown_error", link.error?.message || "");
    return jsonResponse({ error: "Onboarding link could not be created" }, 502);
  }
  return jsonResponse({ url: link.url });
});
