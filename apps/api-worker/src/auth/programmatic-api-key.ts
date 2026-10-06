import type { FindActiveTenantApiKeyByHashInput, TenantApiKeyRecord } from "@credtrail/db";
import type { ProgrammaticApiScope } from "@credtrail/validation";
import { z } from "zod";
import type { AppContext } from "../app/types";
import { programmaticApiError } from "../http/programmatic-api-response";

/** Shared persistence boundary for integration-key authentication. */
export interface ProgrammaticAuthorizationStore {
  findActiveApiKeyByHash(
    input: FindActiveTenantApiKeyByHashInput,
  ): Promise<TenantApiKeyRecord | null>;
  touchApiKeyLastUsedAt(apiKeyId: string, lastUsedAt: string): Promise<void>;
}
/** Authentication binds every operation to one institution. Read access does not require a write actor. */
export const authorizeProgrammaticRequest = async (
  c: AppContext,
  store: ProgrammaticAuthorizationStore,
  input: { readonly tenantId: string; readonly requiredScope: ProgrammaticApiScope },
  sha256Hex: (value: string) => Promise<string>,
): Promise<{ readonly actorUserId: string | null } | { readonly response: Response }> => {
  const rawApiKey = c.req.header("x-api-key")?.trim();
  if (!rawApiKey)
    return {
      response: programmaticApiError(c, 401, "api_key_required", "x-api-key header is required"),
    };
  const nowIso = new Date().toISOString();
  const key = await store.findActiveApiKeyByHash({ keyHash: await sha256Hex(rawApiKey), nowIso });
  if (key === null)
    return {
      response: programmaticApiError(c, 401, "invalid_api_key", "Invalid or expired API key"),
    };
  if (key.tenantId !== input.tenantId)
    return {
      response: programmaticApiError(
        c,
        403,
        "tenant_mismatch",
        "API key tenant does not match request tenant",
      ),
    };
  let scopes: readonly string[] = [];
  try {
    scopes = z.array(z.string()).parse(JSON.parse(key.scopesJson));
  } catch {
    return {
      response: programmaticApiError(
        c,
        403,
        "invalid_api_key_scopes",
        "API key permissions are invalid; create a new key",
      ),
    };
  }
  if (!scopes.includes("*") && !scopes.includes(input.requiredScope)) {
    return {
      response: programmaticApiError(
        c,
        403,
        "insufficient_scope",
        `API key is missing required scope: ${input.requiredScope}`,
      ),
    };
  }
  await store.touchApiKeyLastUsedAt(key.id, nowIso);
  return { actorUserId: key.createdByUserId?.trim() || null };
};

/** Mutations require an attributed owning user in addition to permission. */
export const authorizeProgrammaticWriteRequest = async (
  c: AppContext,
  store: ProgrammaticAuthorizationStore,
  input: { readonly tenantId: string; readonly requiredScope: "queue.issue" | "queue.revoke" },
  sha256Hex: (value: string) => Promise<string>,
): Promise<{ readonly actorUserId: string } | { readonly response: Response }> => {
  const result = await authorizeProgrammaticRequest(c, store, input, sha256Hex);
  if ("response" in result) return result;
  if (result.actorUserId === null)
    return {
      response: programmaticApiError(
        c,
        403,
        "api_key_owner_required",
        "API key is missing an owning user and cannot perform write operations",
      ),
    };
  return { actorUserId: result.actorUserId };
};
