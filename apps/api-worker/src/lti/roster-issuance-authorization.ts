import {
  findLtiResourceLinkPlacement,
  findTenantLmsConnectionByLtiRegistration,
  resolveBadgeRulePlacementAvailabilityForContext,
  type SqlDatabase,
} from "@credtrail/db";
import type { LtiIssuanceActionPayload } from "./issuance-action-token";

/** Rechecks current placement and institutional availability before a roster action. */
export const authorizeLtiRosterIssuance = async (
  db: SqlDatabase,
  action: LtiIssuanceActionPayload,
): Promise<
  { readonly status: "allowed" } | { readonly status: "denied"; readonly detail: string }
> => {
  const [placement, connection] = await Promise.all([
    findLtiResourceLinkPlacement(db, action),
    findTenantLmsConnectionByLtiRegistration(db, action),
  ]);
  if (
    placement === null ||
    placement.status !== "active" ||
    connection === null ||
    placement.tenantId !== action.tenantId ||
    placement.contextId !== action.contextId ||
    placement.ruleId !== action.ruleId ||
    placement.badgeTemplateId !== action.badgeTemplateId
  ) {
    return {
      status: "denied",
      detail: "This course placement is no longer available. Reopen the badge from your LMS.",
    };
  }
  const availability = await resolveBadgeRulePlacementAvailabilityForContext(db, {
    tenantId: action.tenantId,
    ruleId: action.ruleId,
    lmsConnectionId: connection.id,
    contextId: action.contextId,
  });
  return availability.status === "allowed"
    ? { status: "allowed" }
    : {
        status: "denied",
        detail: "This badge rule is no longer offered in this course. Contact your administrator.",
      };
};
