import { describe, expect, it } from "vitest";
import { parseBadgeIssuanceRuleDefinition } from "@credtrail/validation";
import { badgeRenewalValidUntil } from "./badge-renewal";
import {
  evaluateBadgeIssuanceRuleDefinition,
  evaluateBadgeIssuanceRuleRenewal,
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
          trainingAttempts: [
            {
              submittedAt: "2025-01-01T00:00:00.000Z",
              gradedAt: null,
              gradeMatchesCurrentSubmission: null,
              score: null,
            },
          ],
        },
      ],
    };
    const evaluate = (submittedAt: string | null) =>
      evaluateBadgeIssuanceRuleRenewal(
        definition,
        {
          ...facts,
          completions: [
            ...facts.completions,
            {
              courseId: "new",
              learnerId: "student",
              completed: true,
              completionPercent: 100,
              trainingAttempts: [
                { submittedAt, gradedAt: null, gradeMatchesCurrentSubmission: null, score: null },
              ],
            },
          ],
        },
        "2025-06-01T00:00:00.000Z",
      ).matched;
    expect(evaluate(null)).toBe(false);
    expect(evaluate("2025-05-01T00:00:00.000Z")).toBe(false);
    expect(evaluate("2026-10-01T00:00:00.000Z")).toBe(false);
    expect(evaluate("2026-08-01T00:00:00.000Z")).toBe(true);
  });

  it("preserves nested exclusions while still requiring the positive training to be new", () => {
    const completion = (courseId: string) => ({
      type: "course_completion",
      courseId,
      minCompletionPercent: 100,
    });
    const definition = parseBadgeIssuanceRuleDefinition({
      conditions: {
        all: [
          completion("training"),
          { not: { all: [completion("excluded"), { not: completion("override") }] } },
        ],
      },
      options: { renewal: {} },
    });
    const evaluate = (hasOverride: boolean, trainingDate: string) => {
      const facts: BadgeIssuanceRuleEvaluationFacts = {
        learnerId: "student",
        nowIso: "2026-09-01T00:00:00.000Z",
        grades: [],
        submissions: [],
        surveyCompletions: [],
        customFields: [],
        earnedBadgeTemplateIds: [],
        completions: ["training", "excluded", ...(hasOverride ? ["override"] : [])].map(
          (courseId) => ({
            courseId,
            learnerId: "student",
            completed: true,
            completionPercent: 100,
            trainingAttempts: [
              {
                submittedAt: courseId === "training" ? trainingDate : "2025-01-01T00:00:00.000Z",
                gradedAt: null,
                gradeMatchesCurrentSubmission: null,
                score: null,
              },
            ],
          }),
        ),
      };
      return evaluateBadgeIssuanceRuleRenewal(definition, facts, "2025-06-01T00:00:00.000Z")
        .matched;
    };
    expect(evaluate(false, "2026-08-01T00:00:00.000Z")).toBe(false);
    expect(evaluate(true, "2026-08-01T00:00:00.000Z")).toBe(true);
    expect(evaluate(true, "2025-01-01T00:00:00.000Z")).toBe(false);
  });
});

describe("shared confirmation and attempt evidence", () => {
  const previousIssuedAt = "2025-09-01T00:00:00.000Z";
  const nowIso = "2026-09-30T00:00:00.000Z";
  const instructions = "Confirm this year's training.";
  const confirmation = { type: "instructor_confirmation", instructions } as const;
  const facts: BadgeIssuanceRuleEvaluationFacts = {
    learnerId: "student",
    nowIso,
    grades: [],
    completions: [],
    submissions: [],
    surveyCompletions: [],
    customFields: [],
    earnedBadgeTemplateIds: [],
  };
  const define = (conditions: unknown) =>
    parseBadgeIssuanceRuleDefinition({
      conditions,
      options: { issuanceTiming: "manual", renewal: {} },
    });

  it.each([
    { confirmedAt: "2025-08-31T00:00:00.000Z", matches: false },
    { confirmedAt: previousIssuedAt, matches: false },
    { confirmedAt: "2026-09-20T00:00:00.000Z", matches: true },
    { confirmedAt: "2026-10-01T00:00:00.000Z", matches: false },
  ])("requires the confirmation itself to be fresh: $confirmedAt", ({ confirmedAt, matches }) => {
    const recorded = {
      ...facts,
      instructorConfirmations: [{ confirmedByUserId: "instructor", confirmedAt, instructions }],
    };
    const evaluation = evaluateBadgeIssuanceRuleRenewal(
      define(confirmation),
      recorded,
      previousIssuedAt,
    );
    expect(evaluation.matched).toBe(matches);
    expect(evaluation.tree.resultKind).toBe(matches ? "matched" : "missing_data");
  });

  it("keeps preview unmatched and requires confirmation of the exact published instructions", () => {
    const definition = define(confirmation);
    expect(evaluateBadgeIssuanceRuleDefinition(definition, facts)).toMatchObject({
      matched: false,
      canMatchWithInstructorConfirmation: true,
      tree: { matched: false, resultKind: "missing_data" },
    });
    const recorded = {
      ...facts,
      instructorConfirmations: [
        {
          confirmedByUserId: "instructor",
          confirmedAt: nowIso,
          instructions: "A different requirement",
        },
      ],
    };
    expect(evaluateBadgeIssuanceRuleDefinition(definition, recorded).matched).toBe(false);
    expect(
      evaluateBadgeIssuanceRuleDefinition(definition, {
        ...recorded,
        instructorConfirmations: [
          {
            ...recorded.instructorConfirmations[0],
            confirmedByUserId: "instructor",
            confirmedAt: nowIso,
            instructions,
          },
        ],
      }).matched,
    ).toBe(true);
  });

  it("composes confirmation with training, alternatives, and existing exclusions", () => {
    const training = { type: "course_completion", courseId: "training", minCompletionPercent: 100 };
    const excluded = { type: "course_completion", courseId: "excluded", minCompletionPercent: 100 };
    const trainingFacts = {
      ...facts,
      completions: [
        {
          courseId: "training",
          learnerId: "student",
          completed: true,
          completionPercent: 100,
          trainingAttempts: [
            {
              submittedAt: nowIso,
              gradedAt: null,
              gradeMatchesCurrentSubmission: null,
              score: null,
            },
          ],
        },
      ],
    };
    const combined = define({ all: [confirmation, training, { not: excluded }] });
    expect(
      evaluateBadgeIssuanceRuleRenewal(combined, facts, previousIssuedAt)
        .canMatchWithInstructorConfirmation,
    ).toBeUndefined();
    expect(
      evaluateBadgeIssuanceRuleRenewal(combined, trainingFacts, previousIssuedAt),
    ).toMatchObject({ matched: false, canMatchWithInstructorConfirmation: true });
    const confirmed = {
      ...trainingFacts,
      instructorConfirmations: [
        { confirmedByUserId: "instructor", confirmedAt: nowIso, instructions },
      ],
    };
    expect(evaluateBadgeIssuanceRuleRenewal(combined, confirmed, previousIssuedAt).matched).toBe(
      true,
    );
    expect(
      evaluateBadgeIssuanceRuleRenewal(
        combined,
        {
          ...confirmed,
          completions: [
            ...confirmed.completions,
            { courseId: "excluded", learnerId: "student", completed: true, completionPercent: 100 },
          ],
        },
        previousIssuedAt,
      ).matched,
    ).toBe(false);
    expect(
      evaluateBadgeIssuanceRuleRenewal(
        define({ any: [confirmation, training] }),
        trainingFacts,
        previousIssuedAt,
      ).matched,
    ).toBe(true);
    expect(
      evaluateBadgeIssuanceRuleDefinition(
        define({ all: [confirmation, { not: confirmation }] }),
        facts,
      ).canMatchWithInstructorConfirmation,
    ).toBeUndefined();
  });

  it.each([
    {
      submittedAt: "2026-09-20T00:00:00.000Z",
      gradedAt: "2026-09-21T00:00:00.000Z",
      gradeMatchesCurrentSubmission: true,
      matches: true,
    },
    {
      submittedAt: "2025-08-20T00:00:00.000Z",
      gradedAt: "2026-09-21T00:00:00.000Z",
      gradeMatchesCurrentSubmission: true,
      matches: false,
    },
    {
      submittedAt: "2026-09-20T00:00:00.000Z",
      gradedAt: "2026-09-19T00:00:00.000Z",
      gradeMatchesCurrentSubmission: true,
      matches: false,
    },
    {
      submittedAt: "2026-09-20T00:00:00.000Z",
      gradedAt: "2026-10-01T00:00:00.000Z",
      gradeMatchesCurrentSubmission: true,
      matches: false,
    },
    {
      submittedAt: "2026-09-20T00:00:00.000Z",
      gradedAt: "2026-09-21T00:00:00.000Z",
      gradeMatchesCurrentSubmission: false,
      matches: false,
    },
    {
      submittedAt: "2026-09-20T00:00:00.000Z",
      gradedAt: "2026-09-21T00:00:00.000Z",
      gradeMatchesCurrentSubmission: null,
      matches: false,
    },
  ])(
    "uses the same scored-attempt policy for course grades and submissions: $gradedAt/$gradeMatchesCurrentSubmission",
    ({ matches, ...timestamps }) => {
      const attempt = { ...timestamps, score: 95 };
      const recorded = {
        ...facts,
        grades: [
          {
            courseId: "training",
            learnerId: "student",
            currentScore: 95,
            finalScore: 95,
            trainingAttempts: [attempt],
          },
        ],
        submissions: [
          {
            courseId: "training",
            learnerId: "student",
            assignmentId: "assessment",
            workflowState: "graded",
            ...attempt,
          },
        ],
      };
      for (const condition of [
        { type: "grade_threshold", courseId: "training", minScore: 80 },
        {
          type: "assignment_submission",
          courseId: "training",
          assignmentId: "assessment",
          minScore: 80,
        },
      ])
        expect(
          evaluateBadgeIssuanceRuleRenewal(define(condition), recorded, previousIssuedAt).matched,
        ).toBe(matches);
    },
  );

  it("requires every course item to have a new attempt, while completion needs no score", () => {
    const completion = {
      courseId: "training",
      learnerId: "student",
      completed: true,
      completionPercent: 100,
    };
    const fresh = {
      submittedAt: nowIso,
      gradedAt: null,
      gradeMatchesCurrentSubmission: null,
      score: null,
    };
    const definition = define({
      type: "course_completion",
      courseId: "training",
      minCompletionPercent: 100,
    });
    for (const attempts of [
      [],
      null,
      [fresh, { ...fresh, submittedAt: null }],
      [fresh, { ...fresh, submittedAt: previousIssuedAt }],
    ]) {
      expect(
        evaluateBadgeIssuanceRuleRenewal(
          definition,
          { ...facts, completions: [{ ...completion, trainingAttempts: attempts }] },
          previousIssuedAt,
        ).matched,
      ).toBe(false);
    }
    expect(
      evaluateBadgeIssuanceRuleRenewal(
        definition,
        { ...facts, completions: [{ ...completion, trainingAttempts: [fresh] }] },
        previousIssuedAt,
      ).matched,
    ).toBe(true);
  });
});
