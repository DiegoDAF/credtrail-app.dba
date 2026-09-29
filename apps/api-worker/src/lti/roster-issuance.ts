import { authorizeLtiRosterIssuance } from "./roster-issuance-authorization";
import type { LTISession, LtiToolPort } from "@longsightgroup/lti-tool";
import type { AppContext } from "../app/types";
import type { DirectIssueBadgeRequest } from "../badges/recipient-identifiers";
import type { DirectIssueBadgeResult } from "../badges/direct-issue";
import type { SqlDatabase } from "@credtrail/db";
import type { LtiIssuanceActionPayload } from "./issuance-action-token";
import { ltiLogger } from "./log";
import { loadLtiNrpsRoster, type LtiNrpsMember } from "./nrps";
import {
  ltiRosterIssuedBadgeStatesByUserId,
  skippedLtiIssuanceResult,
} from "./roster-issuance-helpers";
import {
  prepareLtiRosterRuleIssuanceContext,
  ltiRosterIssuanceSkipDetail,
} from "./roster-bulk-issuance-context";
import { evaluateLtiRosterMembersEligibility } from "./roster-eligibility";
import { buildLtiRosterIssueBadgeRequest } from "./roster-issue-request";
import type { LtiRosterIssuanceResultEntry } from "./view-models";

export interface ExecuteLtiRosterIssuanceInput {
  c: AppContext;
  db: SqlDatabase;
  ltiTool: Pick<LtiToolPort, "createAdvantage">;
  ltiSession: LTISession;
  issuanceAction: LtiIssuanceActionPayload;
  selectedLearnerUserIds: readonly string[];
  sha256Hex: (value: string) => Promise<string>;
  issueBadgeForTenant: (
    c: AppContext,
    tenantId: string,
    request: DirectIssueBadgeRequest,
    issuedByUserId?: string,
    options?: {
      recipientDisplayName?: string;
      issuerName?: string;
      issuerUrl?: string;
    },
  ) => Promise<DirectIssueBadgeResult>;
}

export interface LtiRosterIssuanceSummary {
  tenantId: string;
  badgeTemplateId: string;
  courseContextTitle: string | null;
  selectedCount: number;
  results: readonly LtiRosterIssuanceResultEntry[];
}

/** Expected roster and authorization failures are handled by the HTTP boundary. */
export type ExecuteLtiRosterIssuanceResult =
  | { readonly status: "completed"; readonly summary: LtiRosterIssuanceSummary }
  | { readonly status: "denied" | "rule_changed" | "roster_unavailable"; readonly detail: string };

export const executeLtiRosterIssuance = async (
  input: ExecuteLtiRosterIssuanceInput,
): Promise<ExecuteLtiRosterIssuanceResult> => {
  const authorization = await authorizeLtiRosterIssuance(input.db, input.issuanceAction);
  if (authorization.status === "denied") return authorization;

  const rosterResult = await loadLtiNrpsRoster({
    ltiTool: input.ltiTool,
    ltiSession: input.ltiSession,
    contextId: input.ltiSession.context.id,
  });

  if (!rosterResult.success) {
    ltiLogger(input.c)?.warn("Could not load LMS roster for resource-link badge issuance", {
      tenantId: input.issuanceAction.tenantId,
      ltiSessionId: input.issuanceAction.ltiSessionId,
      ...rosterResult.failure.logDetail,
    });

    return {
      status: "roster_unavailable",
      detail:
        "CredTrail could not load the learner roster from the LMS. Check the LMS connection settings.",
    };
  }

  const roster = rosterResult.roster;
  const learnersByUserId = new Map(
    roster.learnerMembers.map((member): [string, LtiNrpsMember] => [member.userId, member]),
  );
  const results: LtiRosterIssuanceResultEntry[] = [];
  const issuedBadgeStatesByUserId = await ltiRosterIssuedBadgeStatesByUserId({
    db: input.db,
    action: input.issuanceAction,
    learnerMembers: roster.learnerMembers,
  });
  const ruleContext = await prepareLtiRosterRuleIssuanceContext({
    db: input.db,
    tenantId: input.issuanceAction.tenantId,
    issuer: input.issuanceAction.issuer,
    clientId: input.issuanceAction.clientId,
    deploymentId: input.issuanceAction.deploymentId,
    resourceLinkId: input.issuanceAction.resourceLinkId,
    launchRuleId: null,
    ltiLog: ltiLogger(input.c),
  });
  if (
    ruleContext.prepared?.status !== "ready" ||
    ruleContext.prepared.ruleId !== input.issuanceAction.ruleId ||
    ruleContext.prepared.versionId !== input.issuanceAction.versionId
  ) {
    return {
      status: "rule_changed",
      detail:
        "The approved rule changed. Reopen the badge in your LMS and review the current requirements.",
    };
  }
  const eligibilityByUserId = ruleContext.issuanceBehavior.manualIssuanceAllowed
    ? await evaluateLtiRosterMembersEligibility({
        db: input.db,
        tenantId: input.issuanceAction.tenantId,
        ruleResolution: ruleContext.ruleResolution,
        members: roster.learnerMembers,
        issuedStatesByUserId: issuedBadgeStatesByUserId,
        nowIso: new Date().toISOString(),
        confirmedByUserId: input.issuanceAction.issuedByUserId,
        prepared: ruleContext.prepared,
      })
    : new Map();

  for (const learnerUserId of input.selectedLearnerUserIds) {
    const member = learnersByUserId.get(learnerUserId);

    if (member === undefined) {
      results.push({
        userId: learnerUserId,
        displayName: null,
        email: null,
        status: "skipped",
        message: "Learner is not present in the current LMS roster.",
        assertionId: null,
      });
      continue;
    }

    const issuedState = issuedBadgeStatesByUserId.get(member.userId) ?? null;
    const skipDetail = ltiRosterIssuanceSkipDetail({
      issuedState,
      ruleContext,
    });

    if (skipDetail !== null) {
      results.push(skippedLtiIssuanceResult(member, skipDetail));
      continue;
    }

    const eligibility = eligibilityByUserId.get(member.userId);

    if (eligibility === undefined || !eligibility.eligibleForIssuance) {
      results.push(
        skippedLtiIssuanceResult(
          member,
          eligibility?.detail ?? "Learner is not eligible for badge issuance.",
        ),
      );
      continue;
    }

    const recipientEmail = member.email;

    if (recipientEmail === undefined) {
      results.push(skippedLtiIssuanceResult(member, eligibility.detail));
      continue;
    }

    const request: DirectIssueBadgeRequest = await buildLtiRosterIssueBadgeRequest({
      member: { ...member, email: recipientEmail },
      eligibility,
      tenantId: input.issuanceAction.tenantId,
      badgeTemplateId: input.issuanceAction.badgeTemplateId,
      sha256Hex: input.sha256Hex,
    });
    try {
      const issuance = await input.issueBadgeForTenant(
        input.c,
        input.issuanceAction.tenantId,
        request,
        input.issuanceAction.issuedByUserId,
        { recipientDisplayName: member.displayName },
      );

      results.push({
        userId: member.userId,
        displayName: member.displayName,
        email: member.email ?? null,
        status: issuance.status,
        message:
          issuance.status === "issued"
            ? "Badge issued."
            : "Badge was already issued for this learner.",
        assertionId: issuance.assertionId,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      ltiLogger(input.c)?.error("Roster badge issuance failed", {
        tenantId: input.issuanceAction.tenantId,
        ruleId: input.issuanceAction.ruleId,
        learnerUserId: member.userId,
        operation: "issue_roster_badge",
      });
      results.push({
        userId: member.userId,
        displayName: member.displayName,
        email: member.email ?? null,
        status: "failed",
        message: "Badge issuance failed. Try again; an existing award will not be duplicated.",
        assertionId: null,
      });
    }
  }

  return {
    status: "completed",
    summary: {
      tenantId: input.issuanceAction.tenantId,
      badgeTemplateId: input.issuanceAction.badgeTemplateId,
      courseContextTitle:
        input.ltiSession.context.title.length === 0 ? null : input.ltiSession.context.title,
      selectedCount: input.selectedLearnerUserIds.length,
      results,
    },
  };
};
