import type { BadgeIssuanceRuleTrainingAttempt } from "@credtrail/validation";
import type { BadgeIssuanceRuleEvaluationFacts } from "./engine";

/** Adds calendar months in UTC, clamping month-end dates instead of rolling into another month. */
export const badgeRenewalValidUntil = (issuedAt: string, intervalMonths: number): string => {
  const date = new Date(issuedAt);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + intervalMonths);
  const endOfMonth = new Date(date.getTime());
  endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, endOfMonth.getUTCDate()));
  return date.toISOString();
};

/** Keeps new training evidence for positive renewal requirements; exclusions use the original facts. */
export const factsForBadgeRenewal = (
  facts: BadgeIssuanceRuleEvaluationFacts,
  previousIssuedAt: string,
): BadgeIssuanceRuleEvaluationFacts => {
  const isFresh = (timestamp: string | null | undefined): boolean =>
    timestamp !== null &&
    timestamp !== undefined &&
    Date.parse(timestamp) > Date.parse(previousIssuedAt) &&
    Date.parse(timestamp) <= Date.parse(facts.nowIso);
  const hasCurrentScore = (fact: {
    readonly score: number | null;
    readonly gradeMatchesCurrentSubmission?: boolean | null | undefined;
    readonly submittedAt: string | null;
    readonly gradedAt?: string | null | undefined;
  }): boolean =>
    fact.score !== null &&
    fact.gradeMatchesCurrentSubmission === true &&
    fact.submittedAt !== null &&
    fact.gradedAt !== null &&
    fact.gradedAt !== undefined &&
    Date.parse(fact.gradedAt) >= Date.parse(fact.submittedAt) &&
    Date.parse(fact.gradedAt) <= Date.parse(facts.nowIso);
  const hasFreshTraining = (
    attempts: readonly BadgeIssuanceRuleTrainingAttempt[] | null | undefined,
    scoreRequirement: "required" | "optional",
  ): boolean =>
    attempts !== null &&
    attempts !== undefined &&
    attempts.length > 0 &&
    attempts.every(
      (attempt) =>
        isFresh(attempt.submittedAt) &&
        (scoreRequirement === "optional" || hasCurrentScore(attempt)),
    );
  return {
    ...facts,
    instructorConfirmations: (facts.instructorConfirmations ?? []).filter((fact) =>
      isFresh(fact.confirmedAt),
    ),
    grades: facts.grades.filter((fact) => hasFreshTraining(fact.trainingAttempts, "required")),
    completions: facts.completions.filter((fact) =>
      hasFreshTraining(fact.trainingAttempts, "optional"),
    ),
    submissions: facts.submissions
      .filter((fact) => isFresh(fact.submittedAt))
      .map((fact) => ({ ...fact, score: hasCurrentScore(fact) ? fact.score : null })),
    surveyCompletions: facts.surveyCompletions.filter((fact) => isFresh(fact.completedAt)),
  };
};
