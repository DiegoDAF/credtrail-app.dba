import { describe, expect, it } from "vitest";
import { parseBadgeIssuanceRuleDefinition } from "@credtrail/validation";
import { badgeRenewalValidUntil, factsForBadgeRenewal } from "./badge-renewal";
import {
  evaluateBadgeIssuanceRuleDefinition,
  type BadgeIssuanceRuleEvaluationFacts,
} from "./engine";

describe("annual training policy", () => {
  it("preserves the award time and clamps leap-day and month-end renewal dates", () => {
    expect(badgeRenewalValidUntil("2024-02-29T23:45:30.000Z", 12)).toBe("2025-02-28T23:45:30.000Z");
    expect(badgeRenewalValidUntil("2026-01-31T23:45:30.000Z", 1)).toBe("2026-02-28T23:45:30.000Z");
    expect(badgeRenewalValidUntil("2026-09-29T12:00:00.000Z", 12)).toBe("2027-09-29T12:00:00.000Z");
  });
  it("requires fresh positive training evidence in every successful alternative", () => {
    const training = { type: "course_completion", courseId: "training", minCompletionPercent: 100 };
    const prerequisite = { type: "prerequisite_badge", badgeTemplateId: "other-badge" };
    const parse = (conditions: unknown) =>
      parseBadgeIssuanceRuleDefinition({ conditions, options: { renewal: {} } });
    expect(parse({ all: [training, prerequisite] }).options?.renewal?.intervalMonths).toBe(12);
    expect(() => parse({ any: [training, prerequisite] })).toThrow("Every way to earn");
    expect(() => parse({ not: training })).toThrow("Every way to earn");
    expect(() =>
      parseBadgeIssuanceRuleDefinition({
        conditions: training,
        options: { renewal: { intervalMonths: 0 } },
      }),
    ).toThrow("Too small");
  });
  it("accepts a freshly completed alternative while excluding undated, old and future work", () => {
    const definition = parseBadgeIssuanceRuleDefinition({
      conditions: {
        any: [
          { type: "course_completion", courseId: "old", minCompletionPercent: 100 },
          { type: "course_completion", courseId: "new", minCompletionPercent: 100 },
        ],
      },
      options: { renewal: {} },
    });
    const facts: BadgeIssuanceRuleEvaluationFacts = {
      learnerId: "student",
      nowIso: "2026-09-01T00:00:00.000Z",
      grades: [],
      submissions: [],
      surveyCompletions: [],
      customFields: [],
      earnedBadgeTemplateIds: [],
      completions: [
        {
          courseId: "old",
          learnerId: "student",
          completed: true,
          completionPercent: 100,
          evidenceFrom: "2025-01-01T00:00:00.000Z",
        },
      ],
    };
    const evaluate = (evidenceFrom: string | null) =>
      evaluateBadgeIssuanceRuleDefinition(
        definition,
        factsForBadgeRenewal(
          {
            ...facts,
            completions: [
              ...facts.completions,
              {
                courseId: "new",
                learnerId: "student",
                completed: true,
                completionPercent: 100,
                evidenceFrom,
              },
            ],
          },
          "2025-06-01T00:00:00.000Z",
        ),
      ).matched;
    expect(evaluate(null)).toBe(false);
    expect(evaluate("2025-05-01T00:00:00.000Z")).toBe(false);
    expect(evaluate("2026-10-01T00:00:00.000Z")).toBe(false);
    expect(evaluate("2026-08-01T00:00:00.000Z")).toBe(true);
  });
});
