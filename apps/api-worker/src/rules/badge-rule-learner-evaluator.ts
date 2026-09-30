import type { BadgeIssuanceRuleLmsProviderKind, SqlDatabase } from "@credtrail/db";
import {
  buildIssuanceProvenanceSnapshotJson,
  type BadgeIssuanceRuleDefinition,
} from "@credtrail/validation";
import type { GradebookRequestOptions, GradebookRuleFactReader } from "../lms/gradebook-types";
import { loadRuleFacts } from "./badge-rule-facts-loader";
import {
  evaluateBadgeIssuanceRuleDefinition,
  evaluateBadgeIssuanceRuleRenewal,
  summarizeBadgeIssuanceRuleEvaluation,
  type BadgeIssuanceRuleEvaluationResult,
  type BadgeIssuanceRuleEvaluationSummary,
} from "./engine";

export type BadgeRuleLearnerEvaluationResult =
  | {
      readonly status: "evaluated";
      readonly evaluation: BadgeIssuanceRuleEvaluationResult;
      readonly evaluationSummary: BadgeIssuanceRuleEvaluationSummary;
      readonly provenanceJson: string;
    }
  | {
      readonly status: "unavailable";
      readonly detail: string;
    };

/** Loads facts and evaluates one LMS learner through the canonical badge-rule pipeline. */
export const evaluateBadgeRuleLearner = async (
  input: {
    readonly db: SqlDatabase;
    readonly tenantId: string;
    readonly lmsProviderKind: BadgeIssuanceRuleLmsProviderKind;
    readonly lmsConnectionId?: string | undefined;
    readonly learnerId: string;
    readonly recipientEmail: string;
    readonly definition: BadgeIssuanceRuleDefinition;
    readonly nowIso: string;
    readonly previousIssuedAt?: string | undefined;
    readonly gradebookProvider?: GradebookRuleFactReader | undefined;
  },
  options: GradebookRequestOptions = {},
): Promise<BadgeRuleLearnerEvaluationResult> => {
  try {
    const loadedFacts = await loadRuleFacts(
      {
        db: input.db,
        tenantId: input.tenantId,
        lmsProviderKind: input.lmsProviderKind,
        lmsConnectionId: input.lmsConnectionId,
        learnerId: input.learnerId,
        recipient: {
          identity: input.recipientEmail,
          identityType: "email",
        },
        definition: input.definition,
        gradebookProvider: input.gradebookProvider,
        nowIso: input.nowIso,
      },
      options,
    );
    const evaluation =
      input.previousIssuedAt === undefined
        ? evaluateBadgeIssuanceRuleDefinition(input.definition, loadedFacts)
        : evaluateBadgeIssuanceRuleRenewal(input.definition, loadedFacts, input.previousIssuedAt);
    const evaluationSummary = summarizeBadgeIssuanceRuleEvaluation(evaluation);
    const provenanceJson = buildIssuanceProvenanceSnapshotJson({
      outcome: evaluation.matched ? "matched" : "no_match",
      evaluation: {
        matched: evaluation.matched,
        tree: evaluation.tree,
      },
      evaluationSummary,
      facts: { ...loadedFacts },
      learnerId: input.learnerId,
      nowIso: input.nowIso,
    });

    return {
      status: "evaluated",
      evaluation,
      evaluationSummary,
      provenanceJson,
    };
  } catch (cause: unknown) {
    return {
      status: "unavailable",
      detail:
        cause instanceof Error
          ? cause.message
          : "CredTrail could not evaluate this learner against the badge rule.",
    };
  }
};
