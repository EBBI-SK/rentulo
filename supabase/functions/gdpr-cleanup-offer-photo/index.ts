// Rentulo V1 / BOD 02 / Stage 2 / TEST ONLY.
// Operator-triggered, one-photo-per-call Storage cleanup. NO scheduler.
// This function is NEVER invoked by browsers. The required secret is held
// ONLY in TEST Edge Function environment settings (not in the repo or URL).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Runtime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(key: string): string | undefined };
};
const deno = (globalThis as typeof globalThis & { Deno: Runtime }).Deno;
const TEST_URL = "https://vspposovhdgvbeukoivh.supabase.co";
const TIMEOUT_MS = 9000;

type ClaimedPhoto = { offer_id: string; storage_path: string };

function result(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function equalSecret(provided: string, expected: string): boolean {
  // Reject keys of an unexpected size and compare all code units for equal
  // length; never echo the token, path, owner identity or role key in a log.
  if (provided.length < 48 || provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return mismatch === 0;
}

deno.serve(async (request: Request) => {
  if (request.method !== "POST") return result({ ok: false, error: "Method not allowed" }, 405);
  const url = (deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  const serviceKey = deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const expectedSecret = deno.env.get("RENTULO_GDPR_PHOTO_SECRET") || "";
  const submittedSecret = request.headers.get("x-rentulo-gdpr-photo-secret") || "";

  // The project identity is checked AGAIN by every SQL RPC. In a copied PROD
  // deployment, this endpoint refuses requests before touching the database.
  if (url !== TEST_URL || serviceKey.length < 30 ||
      !equalSecret(submittedSecret, expectedSecret)) {
    return result({ ok: false, error: "Unauthorized" }, 401);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // The DB decides the offer and the Storage path; no user-supplied path.
    const claimed = await admin.rpc("gdpr_claim_deleted_offer_photo")
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (claimed.error) return result({ ok: false, error: "Claim unavailable" }, 503);
    const item = (Array.isArray(claimed.data) ? claimed.data[0] : null) as ClaimedPhoto | undefined;
    if (!item) return result({ ok: true, claimed: 0, removed: 0 });
    if (typeof item.offer_id !== "string" || typeof item.storage_path !== "string" ||
        !/^[0-9a-f-]{36}\/[0-9]{13,16}-offer\.jpg$/.test(item.storage_path)) {
      return result({ ok: false, error: "Invalid approved Storage path" }, 409);
    }

    // Recheck that the approval gate is still enabled, the offer is still
    // deleted, payment evidence is settled and no legal hold appeared.
    const verified = await admin.rpc("gdpr_revalidate_deleted_offer_photo", {
      p_offer_id: item.offer_id,
      p_storage_path: item.storage_path,
    }).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (verified.error || verified.data !== true) {
      // Do not call Supabase Storage if the recheck does not pass.
      await admin.rpc("gdpr_finish_deleted_offer_photo", {
        p_offer_id: item.offer_id,
        p_storage_path: item.storage_path,
        p_success: false,
      }).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
      return result({ ok: false, error: "Approval recheck failed" }, 409);
    }

    const removed = await admin.storage.from("offer-photos")
      .remove([item.storage_path]);
    if (removed.error) {
      await admin.rpc("gdpr_finish_deleted_offer_photo", {
        p_offer_id: item.offer_id,
        p_storage_path: item.storage_path,
        p_success: false,
      }).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
      return result({ ok: false, error: "Storage remove failed" }, 503);
    }

    // If acknowledgement fails after deleting the file, the original DB row
    // remains and the job can be manually inspected/recovered in TEST.
    const finished = await admin.rpc("gdpr_finish_deleted_offer_photo", {
      p_offer_id: item.offer_id,
      p_storage_path: item.storage_path,
      p_success: true,
    }).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (finished.error || finished.data !== true) {
      return result({ ok: false, error: "Storage removed; DB acknowledgement needs review" }, 409);
    }
    return result({ ok: true, claimed: 1, removed: 1 });
  } catch {
    // Never return raw SQL/provider exceptions which may contain paths or PII.
    return result({ ok: false, error: "Temporary cleanup failure" }, 503);
  }
});
