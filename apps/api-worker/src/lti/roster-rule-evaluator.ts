import { normalizeEmail, type SqlDatabase } from "@credtrail/db";
import { resolveGradebookProvider } from "../lms/gradebook-provider-resolution";
import type { GradebookAutomatedEvaluationReader } from "../lms/gradebook-types";
import {
  evaluateBadgeRuleLearner,
  type BadgeRuleLearnerEvaluationResult,
} from "../rules/badge-rule-learner-evaluator";
import { extractBadgeIssuanceRuleRequirements } from "../rules/engine";
import { mapConcurrentBounded } from "../utils/map-concurrent-bounded";
import type { LtiRosterEligibilityPreparedEvaluation } from "./roster-eligibility";

const COURSE_ROSTER_CONCURRENCY = 4;

/** Evaluates an LTI learner using the identity owned by the rule's LMS connection. */
export type LtiRosterRuleEvaluator = (learner: {
  readonly ltiUserId: string;
  readonly recipientEmail: string;
  readonly previousIssuedAt?: string | undefined;
  readonly confirmedByUserId?: string | undefined;
}) => Promise<BadgeRuleLearnerEvaluationResult>;

type LearnerDirectory =
  | {
      readonly status: "ready";
      readonly provider: GradebookAutomatedEvaluationReader;
      readonly idsByEmail: ReadonlyMap<string, ReadonlySet<string>>;
      readonly emailsById: ReadonlyMap<string, ReadonlySet<string>>;
    }
  | { readonly status: "unavailable"; readonly detail: string };

/** Shares one complete LMS roster read across an instructor's eligibility check. */
export const createLtiRosterRuleEvaluator = (input: {
  readonly db: SqlDatabase;
  readonly tenantId: string;
  readonly prepared: LtiRosterEligibilityPreparedEvaluation;
  readonly nowIso: string;
  readonly gradebookProvider?: GradebookAutomatedEvaluationReader | undefined;
}): LtiRosterRuleEvaluator => {
  const prepared = input.prepared;
  if (prepared.status !== "ready") {
    return () => Promise.resolve({ status: "unavailable", detail: prepared.detail });
  }
  const courseIds = extractBadgeIssuanceRuleRequirements(prepared.definition).courseIds;
  let directoryPromise: Promise<LearnerDirectory> | undefined;

  const loadDirectory = async (): Promise<LearnerDirectory> => {
    try {
      // Resolve only from the governed connection, never the course's LTI user ID.
      const provider =
        input.gradebookProvider ??
        (await resolveGradebookProvider({
          db: input.db,
          tenantId: input.tenantId,
          lmsConnectionId: prepared.lmsConnectionId,
          nowIso: input.nowIso,
        }));
      const rosters = await mapConcurrentBounded(
        courseIds,
        { concurrency: COURSE_ROSTER_CONCURRENCY },
        (courseId) => provider.listLearners({ courseId }),
      );
      const idsByEmail = new Map<string, Set<string>>();
      const emailsById = new Map<string, Set<string>>();
      for (const roster of rosters) {
        for (const learner of roster) {
          if (learner.email === null) continue;
          const email = normalizeEmail(learner.email);
          const ids = idsByEmail.get(email) ?? new Set<string>();
          ids.add(learner.learnerId);
          idsByEmail.set(email, ids);
          const emails = emailsById.get(learner.learnerId) ?? new Set<string>();
          emails.add(email);
          emailsById.set(learner.learnerId, emails);
        }
      }
      return { status: "ready", provider, idsByEmail, emailsById };
    } catch {
      return {
        status: "unavailable",
        detail: "CredTrail could not load the complete training roster. Try again later.",
      };
    }
  };

  return async (learner): Promise<BadgeRuleLearnerEvaluationResult> => {
    let learnerId = learner.ltiUserId;
    let gradebookProvider: GradebookAutomatedEvaluationReader | undefined;
    if (courseIds.length > 0) {
      directoryPromise ??= loadDirectory();
      const directory = await directoryPromise;
      if (directory.status === "unavailable") return directory;
      const ids = directory.idsByEmail.get(normalizeEmail(learner.recipientEmail));
      const matchedId = ids?.values().next().value;
      if (matchedId === undefined) {
        return {
          status: "unavailable",
          detail:
            "No learner with this email was found in the training roster. Check their training enrollment and email address.",
        };
      }
      if (ids?.size !== 1 || directory.emailsById.get(matchedId)?.size !== 1) {
        return {
          status: "unavailable",
          detail:
            "The training roster contains conflicting learner identities. Ask your institution to correct them before checking eligibility.",
        };
      }
      learnerId = matchedId;
      gradebookProvider = directory.provider;
    }

    return evaluateBadgeRuleLearner({
      db: input.db,
      tenantId: input.tenantId,
      lmsProviderKind: prepared.lmsProviderKind,
      lmsConnectionId: prepared.lmsConnectionId ?? undefined,
      learnerId,
      recipientEmail: learner.recipientEmail,
      definition: prepared.definition,
      nowIso: input.nowIso,
      previousIssuedAt: learner.previousIssuedAt,
      confirmedByUserId: learner.confirmedByUserId,
      gradebookProvider,
    });
  };
};
