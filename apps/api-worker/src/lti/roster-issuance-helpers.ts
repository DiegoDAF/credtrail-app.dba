import {
  listAssertionsByBadgeTemplatesAndRecipientEmails,
  listAssertionLifecycleStatesByAssertionIds,
  type AssertionLifecycleState,
  type SqlDatabase,
} from "@credtrail/db";
import type { LTISession } from "@longsightgroup/lti-tool";
import type { LtiIssuanceActionPayload } from "./issuance-action-token";
import type { LtiNrpsMember } from "./nrps";
import type { LtiRosterIssuanceResultEntry } from "./view-models";
import { asNonEmptyString } from "../utils/value-parsers";

interface LtiRosterIssuedBadgeState {
  assertionId: string;
  issuedAt: string;
  lifecycleState: AssertionLifecycleState | null;
}

export const selectedLearnerUserIdsFromForm = (form: FormData): string[] => {
  const selected = form
    .getAll("learner_user_id")
    .map((entry) => asNonEmptyString(entry))
    .filter((entry): entry is string => entry !== null);

  return Array.from(new Set(selected));
};

export const ltiSessionMatchesIssuanceAction = (
  ltiSession: LTISession,
  action: LtiIssuanceActionPayload,
): boolean => {
  return (
    ltiSession.id === action.ltiSessionId &&
    ltiSession.platform.issuer === action.issuer &&
    ltiSession.platform.clientId === action.clientId &&
    ltiSession.platform.deploymentId === action.deploymentId &&
    ltiSession.context.id === action.contextId &&
    ltiSession.resourceLink?.id === action.resourceLinkId
  );
};

export const skippedLtiIssuanceResult = (
  member: Pick<LtiNrpsMember, "userId" | "displayName"> & Pick<Partial<LtiNrpsMember>, "email">,
  message: string,
): LtiRosterIssuanceResultEntry => {
  return {
    userId: member.userId,
    displayName: member.displayName,
    email: member.email ?? null,
    status: "skipped",
    message,
    assertionId: null,
  };
};

export const ltiRosterIssuedBadgeStatesByUserId = async (input: {
  db: SqlDatabase;
  action: Pick<LtiIssuanceActionPayload, "tenantId" | "badgeTemplateId">;
  learnerMembers: readonly LtiNrpsMember[];
}): Promise<Map<string, LtiRosterIssuedBadgeState>> => {
  const statesByUserId = new Map<string, LtiRosterIssuedBadgeState>();
  const assertions = await listAssertionsByBadgeTemplatesAndRecipientEmails(input.db, {
    tenantId: input.action.tenantId,
    badgeTemplateIds: [input.action.badgeTemplateId],
    recipientEmails: input.learnerMembers.flatMap((member) =>
      member.email === undefined ? [] : [member.email],
    ),
  });
  const lifecycleStates = await listAssertionLifecycleStatesByAssertionIds(input.db, {
    tenantId: input.action.tenantId,
    assertionIds: assertions.map((assertion) => assertion.id),
  });
  const lifecycleStatesByAssertionId = new Map(
    lifecycleStates.map((lifecycle) => [lifecycle.assertionId, lifecycle]),
  );

  // A badge is the same achievement whichever approved rule or course issued it.
  // Keep the newest record unless an active credential is available.
  const statesByEmail = new Map<string, LtiRosterIssuedBadgeState>();
  for (const assertion of assertions) {
    const email = assertion.recipientIdentity.trim().toLowerCase();
    const lifecycleState = lifecycleStatesByAssertionId.get(assertion.id)?.state ?? null;
    const previous = statesByEmail.get(email);
    if (
      previous !== undefined &&
      (previous.lifecycleState === "active" || lifecycleState !== "active")
    )
      continue;
    statesByEmail.set(email, {
      assertionId: assertion.id,
      issuedAt: assertion.issuedAt,
      lifecycleState,
    });
  }
  for (const member of input.learnerMembers) {
    if (member.email === undefined) continue;
    const state = statesByEmail.get(member.email.trim().toLowerCase());
    if (state !== undefined) statesByUserId.set(member.userId, state);
  }

  return statesByUserId;
};
