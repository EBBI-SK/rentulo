import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildExtensionCheckoutParams, classifyRecoveredCheckoutSession,
  extensionCheckoutIdempotencyKey, mayRetrySameCheckoutAttempt,
  findRecoveredCheckoutSession,
} from "../_shared/extension-checkout-recovery.mjs";

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

type MissingExtensionCheckoutCandidate = {
  attempt_id: string; extension_id: string; reservation_id: string;
  renter_id: string; attempt_created_at: string; checkout_expires_at: string;
  locale: string; offer_name: string; customer_email: string | null;
  previous_end_date: string; new_end_date: string; amount_minor: number | string;
};
type RecoveredCheckoutSession = {
  id?: string; created?: number; expires_at?: number; livemode?: boolean;
  url?: string; status?: string; payment_status?: string;
  mode?: string; currency?: string; amount_total?: number;
  client_reference_id?: string;
  metadata?: Record<string, string>;
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

  // BOD 1 is TEST-only. A future PROD rollout must deploy its own migration
  // first; the existing production transfer job must never depend on it.
  if (supabaseUrl !== "https://vspposovhdgvbeukoivh.supabase.co") {
    return jsonResponse({ ok: true, ...result });
  }

  // Plain requests and approvals without a Stripe session have a strict
  // deadline and can be closed by the existing Cron without payment risk.
  const unstartedExpiry = await admin.rpc("expire_unstarted_reservation_extensions", {
    p_limit: limit,
  });
  if (unstartedExpiry.error) {
    console.error("retry-owner-transfers: unstarted extension expiry failed",
      unstartedExpiry.error.message);
  }

  // Reconcile only sessions that Stripe has VERIFIED as expired and unpaid.
  // A verified expired session can be retried under its existing approval when
  // there is enough time; otherwise the SQL RPC closes the extension.
  // A late but processing payment keeps its date hold until the webhook wins.
  const checkoutCandidates = await admin.rpc("get_expired_reservation_extension_checkouts", {
    p_limit: limit,
  });
  const checkoutSummary = { candidates: 0, reconciled: 0, kept: 0, errors: 0 };
  const stripeKey = denoRuntime.env.get("STRIPE_SECRET_KEY") || "";
  if (checkoutCandidates.error || !Array.isArray(checkoutCandidates.data)) {
    checkoutSummary.errors += 1;
    console.error("retry-owner-transfers: extension checkout scan failed",
      checkoutCandidates.error?.message);
  } else {
    checkoutSummary.candidates = checkoutCandidates.data.length;
    await processWithConcurrency(checkoutCandidates.data as Array<{
      extension_id: string; reservation_id: string;
      session_id: string; amount_minor: number;
    }>, 5, async (candidate) => {
      if (!stripeKey) { checkoutSummary.errors += 1; return; }
      try {
        const response = await fetch(
          `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(candidate.session_id)}`,
          { headers: { Authorization: `Bearer ${stripeKey}` }, signal: AbortSignal.timeout(15000) },
        );
        const session = (await response.json().catch(() => ({}))) as {
          id?: string; mode?: string; currency?: string; amount_total?: number;
          client_reference_id?: string; status?: string; payment_status?: string;
          metadata?: Record<string,string>;
        };
        if (!response.ok || session.id !== candidate.session_id || session.mode !== "payment" ||
            session.client_reference_id !== candidate.extension_id ||
            session.currency !== "czk" || session.amount_total !== candidate.amount_minor ||
            session.metadata?.payment_kind !== "reservation_extension" ||
            session.metadata?.extension_id !== candidate.extension_id ||
            session.metadata?.reservation_id !== candidate.reservation_id) {
          checkoutSummary.errors += 1;
          return;
        }
        if (session.status !== "expired" || session.payment_status !== "unpaid") {
          checkoutSummary.kept += 1;
          return;
        }
        const recorded = await admin.rpc("expire_reservation_extension_checkout", {
          p_extension_id: candidate.extension_id, p_session_id: candidate.session_id,
        });
        if (recorded.error) checkoutSummary.errors += 1;
        else if (recorded.data === true) checkoutSummary.reconciled += 1;
        else checkoutSummary.kept += 1;
      } catch (error) {
        checkoutSummary.errors += 1;
        console.error("retry-owner-transfers: failed to reconcile expired checkout",
          candidate.extension_id, error instanceof Error ? error.message : String(error));
      }
    });
  }

  // BOD 4: a Stripe POST can have succeeded even when its HTTP response was
  // lost. Recover ONLY the original attempt: same snapshot/idempotency key,
  // or discover the exact attempt in Stripe's read-only Session listing.
  // Never release its date hold from an absent/incomplete Stripe response.
  const unresolved = await admin.rpc("get_unrecorded_extension_checkout_recovery_candidates", {
    p_limit: Math.min(limit, 2),
  });
  const missingSessionSummary = { candidates: 0, recovered: 0, expired: 0, review: 0, pending: 0, errors: 0 };
  const recoverySiteUrl = (denoRuntime.env.get("SITE_URL") || "").replace(/\/+$/, "");
  if (unresolved.error || !Array.isArray(unresolved.data)) {
    missingSessionSummary.errors += 1;
    console.error("retry-owner-transfers: missing-session candidate scan failed",
      unresolved.error?.message);
  } else if (!stripeKey.startsWith("sk_test_") || recoverySiteUrl !== "https://rentulo.eu") {
    missingSessionSummary.errors += 1;
    console.error("retry-owner-transfers: missing-session recovery requires TEST Stripe/site configuration");
  } else {
    missingSessionSummary.candidates = unresolved.data.length;
    await processWithConcurrency(unresolved.data as MissingExtensionCheckoutCandidate[], 2,
      async (candidate) => {
        const createdMs = Date.parse(candidate.attempt_created_at);
        const expiresMs = Date.parse(candidate.checkout_expires_at);
        const expiresAtUnix = Math.floor(expiresMs / 1000);
        const createdAfterUnix = Math.floor(createdMs / 1000) - 2;
        const amountMinor = Number(candidate.amount_minor);
        if (!Number.isFinite(createdMs) || !Number.isFinite(expiresMs) ||
            !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
            expiresAtUnix <= createdAfterUnix || !candidate.attempt_id) {
          missingSessionSummary.errors += 1;
          return;
        }
        const expected = {
          attemptId: candidate.attempt_id, extensionId: candidate.extension_id,
          reservationId: candidate.reservation_id, amountMinor,
          createdAfterUnix, expiresAtUnix,
        };
        let verified: { session: RecoveredCheckoutSession; state: string } | null = null;

        // Stripe v1 can drop idempotency keys after 24h. Never POST with the
        // old key outside a conservative 22h safe window.
        if (mayRetrySameCheckoutAttempt(createdMs, expiresMs, Date.now())) {
          const params = buildExtensionCheckoutParams({
            attemptId: candidate.attempt_id, checkoutExpiresAt: candidate.checkout_expires_at,
            locale: candidate.locale, offerName: candidate.offer_name,
            customerEmail: candidate.customer_email, siteUrl: recoverySiteUrl,
            extensionId: candidate.extension_id, reservationId: candidate.reservation_id,
            previousEndDate: candidate.previous_end_date, newEndDate: candidate.new_end_date,
            amountMinor,
          });
          try {
            const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
              method: "POST", headers: {
                Authorization: `Bearer ${stripeKey}`,
                "Content-Type": "application/x-www-form-urlencoded",
                "Idempotency-Key": extensionCheckoutIdempotencyKey(candidate.attempt_id),
              }, body: params, signal: AbortSignal.timeout(12_000),
            });
            const session = await response.json().catch(() => null) as RecoveredCheckoutSession | null;
            if (response.ok && session) {
              const state = classifyRecoveredCheckoutSession(session, expected);
              if (state !== "invalid") verified = { session, state };
            }
          } catch (_) {
            // Network failure is unknown, not permission to rotate the key.
          }
        }

        let fullySearched = false;
        if (!verified) {
          const lookup = await findRecoveredCheckoutSession(stripeKey, expected);
          if (lookup.status === "matched") {
            verified = { session: lookup.session as RecoveredCheckoutSession,
              state: lookup.state as string };
          } else if (lookup.status === "none") {
            fullySearched = true;
          } else if (lookup.status === "ambiguous") {
            missingSessionSummary.errors += 1;
            console.error("retry-owner-transfers: multiple Sessions for one Checkout attempt",
              candidate.extension_id);
            return;
          }
        }

        if (verified) {
          // Only a positively matched Stripe Session can be attached. Even a
          // past expiry is recorded so a successful payment webhook can finish.
          const record = await admin.rpc("record_reservation_extension_checkout_attempt", {
            p_extension_id: candidate.extension_id,
            p_renter_id: candidate.renter_id,
            p_attempt_id: candidate.attempt_id,
            p_session_id: verified.session.id,
            p_expires_at: candidate.checkout_expires_at,
          });
          if (record.error || record.data !== true) {
            missingSessionSummary.errors += 1;
            return;
          }
          missingSessionSummary.recovered += 1;
          if (verified.state === "verified_expired") {
            const closed = await admin.rpc("expire_reservation_extension_checkout", {
              p_extension_id: candidate.extension_id, p_session_id: verified.session.id,
            });
            if (closed.error) missingSessionSummary.errors += 1;
            else if (closed.data === true) missingSessionSummary.expired += 1;
          }
          return;
        }

        // Even a complete negative Stripe list is NOT proof no payment ever
        // existed. Mark for manual review; NEVER rotate, expire, or unlock.
        if (fullySearched && Date.now() > expiresMs + 5 * 60 * 1000) {
          const marked = await admin.rpc("flag_unrecorded_extension_checkout_for_review", {
            p_extension_id: candidate.extension_id, p_attempt_id: candidate.attempt_id,
          });
          if (!marked.error && marked.data === true) {
            missingSessionSummary.review += 1;
            console.error("retry-owner-transfers: missing Stripe Session needs manual review",
              candidate.extension_id);
            return;
          }
          missingSessionSummary.errors += 1;
        } else {
          missingSessionSummary.pending += 1;
        }
      });
  }

  // Use the SAME authenticated 5-minute retry job for additional-day
  // payouts, but do not change or duplicate the original payment transfer.
  const extensions = await admin.rpc("get_due_reservation_extension_transfers", { p_limit: limit });
  if (extensions.error || !Array.isArray(extensions.data)) {
    console.error("retry-owner-transfers: extension candidates unavailable", extensions.error?.message);
    return jsonResponse({ error: "Extension transfers could not be checked", ...result }, 500);
  }
  const extensionSummary = {
    candidates: extensions.data.length, succeeded: 0, failed: 0, skipped: 0,
  };
  await processWithConcurrency(extensions.data as Array<{ extension_id: string; reservation_id: string }>, 5,
    async (extension) => {
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/create-extension-transfer`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey,
            "Content-Type": "application/json" },
          body: JSON.stringify({ extension_id: extension.extension_id }),
          signal: AbortSignal.timeout(25_000),
        });
        const body = (await response.json().catch(() => ({}))) as OwnerTransferResponse;
        if (response.ok && body.status === "succeeded") {
          extensionSummary.succeeded += 1;
        } else if (response.status === 409 &&
            body.error === "Extension transfer is not ready for processing") {
          extensionSummary.skipped += 1;
        } else {
          extensionSummary.failed += 1;
          console.error("retry-owner-transfers: extension transfer failed", extension.extension_id,
            response.status, body.error || "unknown_error");
        }
      } catch (error) {
        extensionSummary.failed += 1;
        console.error("retry-owner-transfers: extension transport error", extension.extension_id,
          error instanceof Error ? error.message : String(error));
      }
    });

  return jsonResponse({ ok: true, ...result,
    expired_unstarted_extensions: unstartedExpiry.error ? null : unstartedExpiry.data,
    extension_checkouts: checkoutSummary,
    missing_extension_checkouts: missingSessionSummary,
    extensions: extensionSummary });
});
