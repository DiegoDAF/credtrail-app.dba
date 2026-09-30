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
  return {
    ...facts,
    grades: facts.grades.filter((fact) => isFresh(fact.evidenceFrom)),
    completions: facts.completions.filter((fact) => isFresh(fact.evidenceFrom)),
    submissions: facts.submissions
      .filter((fact) => isFresh(fact.submittedAt))
      .map((fact) => ({
        ...fact,
        score:
          fact.gradeMatchesCurrentSubmission === true &&
          fact.gradedAt !== null &&
          fact.gradedAt !== undefined &&
          fact.submittedAt !== null &&
          Date.parse(fact.gradedAt) >= Date.parse(fact.submittedAt) &&
          Date.parse(fact.gradedAt) <= Date.parse(facts.nowIso)
            ? fact.score
            : null,
      })),
    surveyCompletions: facts.surveyCompletions.filter((fact) => isFresh(fact.completedAt)),
  };
};
