import {
  badgeRuleInstructorConfirmation,
  buildIssuanceProvenanceSnapshotJson,
} from "@credtrail/validation";
import type {
  LtiRosterEligibilityPreparedEvaluation,
  LtiRosterEligibilityResult,
} from "./roster-eligibility";

/** Resolves a course-free requirement for display, or records the instructor's explicit confirmation. */
export const instructorConfirmationEligibility = (input: {
  readonly prepared: Extract<LtiRosterEligibilityPreparedEvaluation, { status: "ready" }>;
  readonly learnerId: string;
  readonly nowIso: string;
  readonly confirmedByUserId?: string | undefined;
}): LtiRosterEligibilityResult | null => {
  const requirement = badgeRuleInstructorConfirmation(input.prepared.definition.conditions);
  if (requirement === null) return null;
  const ready: LtiRosterEligibilityResult = {
    status: "eligible",
    label: "Awaiting confirmation",
    detail: requirement.instructions,
    eligibleForIssuance: true,
  };
  if (input.confirmedByUserId === undefined) return ready;
  return {
    ...ready,
    label: "Confirmed",
    issuanceProvenance: {
      ruleId: input.prepared.ruleId,
      versionId: input.prepared.versionId,
      provenanceJson: buildIssuanceProvenanceSnapshotJson({
        outcome: "matched",
        evaluation: {
          matched: true,
          tree: {
            type: "instructor_confirmation",
            matched: true,
            detail: requirement.instructions,
            resultKind: "matched",
          },
        },
        facts: {
          learnerId: input.learnerId,
          nowIso: input.nowIso,
          instructorConfirmation: {
            confirmedByUserId: input.confirmedByUserId,
            instructions: requirement.instructions,
          },
        },
        learnerId: input.learnerId,
        nowIso: input.nowIso,
      }),
    },
  };
};
