import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

type OwnerTransferRetryCandidate = {
  payment_id: string;
  reservation_id: string;
  transfer_status: string;
  transfer_attempt_count: number;
  eligible_at: string;
};

type OwnerTransferResponse = {
  status?: string;
  error?: string;
  transfer_id?: string;
};

const denoRuntime = (
  globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }
).Deno;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        await worker(items[index]);
      }
    },
  );

  await Promise.all(runners);
}

denoRuntime.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = denoRuntime.env.get("SUPABASE_URL");
  const serviceRoleKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("retry-owner-transfers: missing server configuration");
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Internal-only Cron worker. The database sends a dedicated random secret
  // stored in Supabase Vault. No service-role key is persisted in Cron or SQL.
  const cronSecret = (req.headers.get("x-rentulo-cron-secret") || "").trim();
  if (!cronSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { data: cronAuthorized, error: cronAuthError } = await admin.rpc(
    "verify_owner_transfer_retry_cron_secret",
    { p_secret: cronSecret },
  );

  if (cronAuthError || cronAuthorized !== true) {
    if (cronAuthError) {
      console.error("retry-owner-transfers: cron auth failed", cronAuthError.message);
    }
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let limit = 10;
  const requestBody = await req.text();
  if (requestBody.trim()) {
    let payload: { limit?: unknown };
    try {
      payload = JSON.parse(requestBody) as { limit?: unknown };
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const requestedLimit = Number(payload.limit);
    if (Number.isSafeInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 50) {
      limit = requestedLimit;
    }
  }

  const { data: candidatesData, error: candidatesError } = await admin.rpc(
    "get_due_stripe_owner_transfer_retry_candidates",
    { p_limit: limit },
  );

  if (candidatesError) {
    console.error("retry-owner-transfers: candidate lookup failed", candidatesError.message);
    return jsonResponse({ error: "Owner transfer retry lookup failed" }, 500);
  }

  const candidates = (candidatesData || []) as OwnerTransferRetryCandidate[];
  const result = {
    candidates: candidates.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  await processWithConcurrency(candidates, 5, async (candidate) => {
    try {
      const transferResponse = await fetch(
        `${supabaseUrl}/functions/v1/create-owner-transfer`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reservation_id: candidate.reservation_id }),
          signal: AbortSignal.timeout(25_000),
        },
      );

      const transferBody = (
        await transferResponse.json().catch(() => ({}))
      ) as OwnerTransferResponse;

      if (transferResponse.ok && transferBody.status === "succeeded") {
        result.succeeded += 1;
        return;
      }

      // Another invocation may have claimed the same candidate between the
      // candidate scan and this call. That is expected and not a payout failure.
      if (
        transferResponse.status === 409 &&
        transferBody.error === "Owner transfer is not ready for processing"
      ) {
        result.skipped += 1;
        return;
      }

      console.error("retry-owner-transfers: payout attempt did not succeed", {
        payment_id: candidate.payment_id,
        reservation_id: candidate.reservation_id,
        status: transferResponse.status,
        error: transferBody.error || "unknown_error",
      });
      result.failed += 1;
    } catch (error) {
      // create-owner-transfer owns the attempt state. If this request times out
      // after it claimed work, the 15-minute stale-pending recovery path safely
      // makes the attempt eligible again without the worker mutating money state.
      console.error("retry-owner-transfers: payout request failed", {
        payment_id: candidate.payment_id,
        reservation_id: candidate.reservation_id,
        error: error instanceof Error ? error.message : String(error),
      });
      result.failed += 1;
    }
  });

  return jsonResponse({ ok: true, ...result });
});
