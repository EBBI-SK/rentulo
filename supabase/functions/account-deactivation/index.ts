import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RentuloDenoRuntime = {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: {
    get(name: string): string | undefined;
  };
};

const denoRuntime = (
  globalThis as typeof globalThis & { Deno: RentuloDenoRuntime }
).Deno;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type DeactivationStatus = {
  account_status: string;
  can_deactivate: boolean;
  blocking_reservations_count: number;
  blocking_as_owner_count: number;
  blocking_as_renter_count: number;
  offers_to_close_count: number;
  open_owner_debts_count: number;
  unfinished_refunds_count: number;
  unresolved_owner_transfers_count: number;
};

type FinalizeResult = {
  account_status: string;
  closed_offers_count: number;
  deactivated_at: string | null;
};

// BOD02_PHOTO_CLEANUP_START
// Only objects inside this authenticated owner's Storage prefix may be removed.
// List/delete in bounded batches, including nested prefixes if any. This is
// deliberately repeatable: partial Storage failures leave the Auth login intact
// so the deactivated user can retry without recreating the account.
async function deleteOwnerOfferPhotos(
  admin: { storage: ReturnType<typeof createClient>["storage"] }, ownerId: string,
): Promise<number> {
  const bucket = admin.storage.from("offer-photos");
  const folders = [ownerId];
  const visited = new Set<string>();
  let operations = 0;
  let removed = 0;

  while (folders.length > 0) {
    const folder = folders.shift()!;
    if (visited.has(folder)) continue;
    visited.add(folder);

    let offset = 0;
    while (true) {
      // Safe upper bound on work in one Edge invocation. Progress is retained
      // across retries because successfully removed objects stay removed.
      if (++operations > 80) throw new Error("Photo cleanup batch limit reached");
      const { data, error } = await bucket.list(folder, { limit: 100, offset });
      if (error || !Array.isArray(data)) throw new Error("Photo cleanup list failed");
      if (data.length === 0) break;

      const files: string[] = [];
      const subfolders: string[] = [];
      for (const entry of data) {
        const name = entry && entry.name;
        if (!name || name === "." || name === ".." || name.includes("/")) {
          throw new Error("Unexpected object name in photo folder");
        }
        const path = folder + "/" + name;
        if (entry.id === null) {
          subfolders.push(path);
        } else {
          files.push(path);
        }
      }

      if (files.length > 0) {
        const { error: removeError } = await bucket.remove(files);
        if (removeError) throw new Error("Photo cleanup remove failed");
        removed += files.length;
        // Deleting objects shifts list offsets: start again from zero.
        offset = 0;
        continue;
      }

      folders.push(...subfolders);
      if (data.length < 100) break;
      offset += data.length;
    }
  }
  return removed;
}
// BOD02_PHOTO_CLEANUP_END

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) {
    return (value[0] as T | undefined) ?? null;
  }

  if (value && typeof value === "object") {
    return value as T;
  }

  return null;
}

function activeReservationBlockResponse(status: DeactivationStatus | null): Response {
  return jsonResponse({
    error: "Account has active reservations",
    code: "ACCOUNT_HAS_ACTIVE_RESERVATIONS",
    ...(status ? {
      blocking_reservations_count: status.blocking_reservations_count,
      blocking_as_owner_count: status.blocking_as_owner_count,
      blocking_as_renter_count: status.blocking_as_renter_count,
    } : {}),
  }, 409);
}

function financialBlockResponse(status: DeactivationStatus | null): Response {
  return jsonResponse({
    error: "Account has unresolved financial obligations",
    code: "ACCOUNT_HAS_FINANCIAL_OBLIGATIONS",
    ...(status ? {
      open_owner_debts_count: status.open_owner_debts_count,
      unfinished_refunds_count: status.unfinished_refunds_count,
      unresolved_owner_transfers_count: status.unresolved_owner_transfers_count,
    } : {}),
  }, 409);
}

denoRuntime.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = denoRuntime.env.get("SUPABASE_URL");
  const anonKey = denoRuntime.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = denoRuntime.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("account-deactivation: missing server configuration");
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  const actor = userData.user;

  if (userError || !actor) {
    console.warn("account-deactivation: caller authentication failed");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Give the caller useful blocking counts before the trusted finalizer runs.
  // A previously deactivated account is allowed to continue so a safe retry can
  // finish the Auth soft-delete after a temporary server/network failure.
  const { data: statusData, error: statusError } = await userClient.rpc(
    "get_my_account_deactivation_status_v2",
  );

  if (statusError) {
    console.error("account-deactivation: eligibility check failed", statusError.message);
    return jsonResponse({ error: "Account status check failed" }, 500);
  }

  const status = firstRow<DeactivationStatus>(statusData);

  if (!status) {
    return jsonResponse({ error: "Account status not found" }, 404);
  }

  if (status.account_status !== "active" && status.account_status !== "deactivated") {
    return jsonResponse(
      {
        error: "Account cannot be deactivated in its current state",
        code: "ACCOUNT_NOT_ACTIVE",
        account_status: status.account_status,
      },
      409,
    );
  }

  if (status.account_status === "active" && !status.can_deactivate) {
    if (status.blocking_reservations_count > 0) {
      return activeReservationBlockResponse(status);
    }
    return financialBlockResponse(status);
  }

  let finalizeResult: FinalizeResult = {
    account_status: "deactivated",
    closed_offers_count: 0,
    deactivated_at: null,
  };

  if (status.account_status === "active") {
    const { data: finalizeData, error: finalizeError } = await admin.rpc(
      "finalize_account_deactivation",
      { target_user_id: actor.id },
    );

    if (finalizeError) {
      const detail = `${finalizeError.message || ""} ${finalizeError.details || ""}`;

      if (
        detail.includes("Account has active reservations") ||
        detail.includes("Account has unresolved financial obligations")
      ) {
        // The finalizer may have seen a blocker created after the first check.
        // Re-read the caller's own status to report accurate counts if possible.
        let refreshed: DeactivationStatus | null = null;
        try {
          const { data, error } = await userClient.rpc("get_my_account_deactivation_status_v2");
          if (!error) refreshed = firstRow<DeactivationStatus>(data);
        } catch (refreshError) {
          console.warn("account-deactivation: could not refresh blocker details", refreshError);
        }

        return detail.includes("Account has active reservations")
          ? activeReservationBlockResponse(refreshed)
          : financialBlockResponse(refreshed);
      }

      console.error("account-deactivation: database finalization failed", finalizeError.message);
      return jsonResponse({ error: "Account deactivation failed" }, 500);
    }

    const parsedFinalizeResult = firstRow<FinalizeResult>(finalizeData);
    if (parsedFinalizeResult) {
      finalizeResult = parsedFinalizeResult;
    }
  }

  // Finish physical Storage cleanup before removing the Auth login. If Storage
  // fails, the profile stays deactivated and its offers are already sanitized,
  // but the user retains the ability to retry this same protected endpoint.
  try {
    await deleteOwnerOfferPhotos(admin, actor.id);
  } catch (_photoError) {
    console.error("account-deactivation: offer photo cleanup incomplete; retry required");
    return jsonResponse({
      error: "Offer photo cleanup is incomplete. Retry account cancellation.",
      code: "PHOTO_CLEANUP_FAILED",
    }, 503);
  }

  // Soft-delete keeps the Auth row as a non-reversible hashed identity instead
  // of triggering the ON DELETE CASCADE chain from auth.users -> public.profiles.
  const { error: deleteUserError } = await admin.auth.admin.deleteUser(actor.id, true);

  if (deleteUserError) {
    console.error("account-deactivation: Auth soft-delete failed", deleteUserError.message);
    return jsonResponse(
      {
        error: "Account data was deactivated, but sign-in removal could not be completed",
        code: "AUTH_SOFT_DELETE_FAILED",
      },
      500,
    );
  }

  return jsonResponse({
    ok: true,
    account_status: "deactivated",
    closed_offers_count: finalizeResult.closed_offers_count,
    deactivated_at: finalizeResult.deactivated_at,
  });
});
