import { expect, it } from "vitest";
import {
  activateBadgeIssuanceRuleVersion,
  createLearnerPathwayDraft,
  createLearnerProfile,
  enrollLearnerInPathway,
  evaluateLearnerPathwayEnrollment,
  finalizeAssertionIssuance,
  listLearnerPathwayProgress,
  publishLearnerPathway,
  recordAssertionRevocation,
} from "@credtrail/db";
import { parseQueueJob } from "@credtrail/validation";
import {
  cleanupTestResources,
  createBadgeRuleIntegrationFixture,
  describeDbIntegration,
  seedAssertion,
  seedBadgeTemplate,
  uniqueTestId,
} from "../../../../packages/db/src/postgres-test-support";
import { createTestBadgeIssuanceRule } from "../../../../packages/db/src/badge-issuance-rule-test-fixtures";
import type { DirectIssueBadgeRequest } from "../badges/recipient-identifiers";
import { ltiRosterIssuedBadgeStatesByUserId } from "../lti/roster-issuance-helpers";
import { evaluateLtiRosterMemberEligibility } from "../lti/roster-eligibility";
import { sampleLtiRosterMember } from "../lti/roster-eligibility-test-fixtures";
import { DashboardPathways } from "./dashboard-pathways";
import { processLearnerPathwayAward } from "./pathway-award-processor";

const createScenario = async () => {
  const fixture = await createBadgeRuleIntegrationFixture();
  const actor = { id: fixture.userId };
  const learnerEmail = `${uniqueTestId("first_year")}@example.edu`;
  const learner = await createLearnerProfile(fixture.db, {
    tenantId: fixture.tenantId,
    primaryIdentityType: "email",
    primaryIdentityValue: learnerEmail,
  });
  const titles = ["Harassment prevention", "AI training", "Library research"];
  const requiredBadges = await Promise.all(
    titles.map(async (title) => ({
      title,
      badgeTemplateId: await seedBadgeTemplate(fixture.db, { tenantId: fixture.tenantId, title }),
    })),
  );
  const finalBadgeTemplateId = await seedBadgeTemplate(fixture.db, {
    tenantId: fixture.tenantId,
    title: "First-Year badge",
  });
  await fixture.db
    .prepare("UPDATE badge_templates SET image_uri = ? WHERE tenant_id = ? AND id = ?")
    .bind(
      `https://credtrail.org/badges/assets/${fixture.tenantId}/${finalBadgeTemplateId}/test-artwork`,
      fixture.tenantId,
      finalBadgeTemplateId,
    )
    .run();
  const seminarRule = await createTestBadgeIssuanceRule(fixture.db, {
    tenantId: fixture.tenantId,
    name: "First-Year seminar prerequisite",
    badgeTemplateId: finalBadgeTemplateId,
    lmsProviderKind: "canvas",
    lmsConnectionId: fixture.lmsConnectionId,
    createdByUserId: actor.id,
    ruleJson: JSON.stringify({
      conditions: {
        all: requiredBadges.map((badge) => ({
          type: "prerequisite_badge",
          badgeTemplateId: badge.badgeTemplateId,
        })),
      },
      options: { issuanceTiming: "manual" },
    }),
  });
  await fixture.db
    .prepare(
      "UPDATE badge_issuance_rule_versions SET status = 'approved' WHERE tenant_id = ? AND id = ?",
    )
    .bind(fixture.tenantId, seminarRule.version.id)
    .run();
  await activateBadgeIssuanceRuleVersion(fixture.db, {
    tenantId: fixture.tenantId,
    ruleId: seminarRule.rule.id,
    versionId: seminarRule.version.id,
    actorUserId: actor.id,
    activatedAt: new Date().toISOString(),
  });
  const pathway = await createLearnerPathwayDraft(fixture.db, {
    tenantId: fixture.tenantId,
    actorUserId: actor.id,
    ownerOrgUnitId: `${fixture.tenantId}:org:institution`,
    title: "First-Year readiness",
    learnerDescription: "Complete all three trainings before the research seminar.",
    completionBehavior: "issue_credential",
    finalBadgeTemplateId,
    requirements: requiredBadges.map((badge) => ({ ...badge, requirementKind: "badge_template" })),
  });
  await publishLearnerPathway(fixture.db, {
    tenantId: fixture.tenantId,
    pathwayId: pathway.id,
    actorUserId: actor.id,
  });
  const enrollmentId = await enrollLearnerInPathway(fixture.db, {
    tenantId: fixture.tenantId,
    pathwayId: pathway.id,
    actorUserId: actor.id,
    learnerProfileId: learner.id,
  });
  const evaluate = () =>
    evaluateLearnerPathwayEnrollment(fixture.db, {
      tenantId: fixture.tenantId,
      enrollmentId,
      trigger: "assertion_issued",
    });
  const progress = () =>
    listLearnerPathwayProgress(fixture.db, {
      tenantId: fixture.tenantId,
      learnerProfileId: learner.id,
    });
  const jobs = async () =>
    (
      await fixture.db
        .prepare(`
    SELECT payload_json AS payloadJson, idempotency_key AS idempotencyKey
    FROM job_queue_messages WHERE tenant_id = ? AND job_type = 'issue_learner_pathway_badge'
    ORDER BY created_at, id
  `)
        .bind(fixture.tenantId)
        .all<{ payloadJson: string; idempotencyKey: string }>()
    ).results.map((row) => {
      const job = parseQueueJob({
        jobType: "issue_learner_pathway_badge",
        tenantId: fixture.tenantId,
        payload: JSON.parse(row.payloadJson),
        idempotencyKey: row.idempotencyKey,
      });
      if (job.jobType !== "issue_learner_pathway_badge") throw new Error("Unexpected award job");
      return job;
    });
  const awardTraining = (badgeTemplateId: string) =>
    seedAssertion(fixture.db, {
      tenantId: fixture.tenantId,
      learnerProfileId: learner.id,
      badgeTemplateId,
      recipientIdentity: learnerEmail,
      issuedAt: new Date().toISOString(),
    });
  const issueBadge = async (request: DirectIssueBadgeRequest) => {
    const id = uniqueTestId("pathway_assertion");
    const result = await finalizeAssertionIssuance(fixture.db, {
      assertion: {
        id,
        publicId: crypto.randomUUID(),
        tenantId: fixture.tenantId,
        learnerProfileId: learner.id,
        recipientIdentity: request.recipientIdentity,
        recipientIdentityType: request.recipientIdentityType,
        vcR2Key: `test/${id}.json`,
        statusListIndex: 0,
        idempotencyKey: request.idempotencyKey ?? id,
        issuedAt: new Date().toISOString(),
      },
      achievementSource: request.achievementSource,
      learnerPathwayCompletionHandoffId: request.learnerPathwayCompletionHandoffId,
      buildAuditLog: (assertion) => ({
        tenantId: fixture.tenantId,
        action: "assertion.issued",
        targetType: "assertion",
        targetId: assertion.id,
      }),
    });
    return result;
  };
  return {
    ...fixture,
    seminarRuleId: seminarRule.rule.id,
    actor,
    learner,
    learnerEmail,
    requiredBadges,
    finalBadgeTemplateId,
    enrollmentId,
    evaluate,
    progress,
    jobs,
    awardTraining,
    issueBadge,
    dispose: () =>
      cleanupTestResources(fixture.db, { tenantIds: [fixture.tenantId], userIds: [actor.id] }),
  };
};

describeDbIntegration("automatic first-year pathway awards", () => {
  it("refuses to finalize when training evidence is revoked during issuance", async () => {
    const scenario = await createScenario();
    try {
      const assertions = await Promise.all(
        scenario.requiredBadges.map((badge) => scenario.awardTraining(badge.badgeTemplateId)),
      );
      await scenario.evaluate();
      const job = (await scenario.jobs())[0];
      const revokedId = assertions[0];
      if (job === undefined || revokedId === undefined)
        throw new Error("Expected completed scenario");
      await expect(
        processLearnerPathwayAward({
          db: scenario.db,
          tenantId: scenario.tenantId,
          ...job.payload,
          issueBadge: async (request) => {
            await recordAssertionRevocation(scenario.db, {
              tenantId: scenario.tenantId,
              assertionId: revokedId,
              revocationId: uniqueTestId("rev"),
              idempotencyKey: uniqueTestId("revkey"),
              reason: "Evidence changed while signing",
              revokedAt: new Date().toISOString(),
            });
            const result = await scenario.issueBadge(request);
            expect(result.status).toBe("learner_pathway_handoff_conflict");
            throw new Error("Issuance rejected after evidence changed");
          },
        }),
      ).rejects.toThrow("Issuance rejected after evidence changed");
      expect((await scenario.progress())[0]?.state._tag).toBe("invalidated");
      const count = await scenario.db
        .prepare(
          "SELECT COUNT(*)::int AS count FROM assertions WHERE tenant_id = ? AND badge_template_id = ?",
        )
        .bind(scenario.tenantId, scenario.finalBadgeTemplateId)
        .first<{ count: number }>();
      expect(count?.count).toBe(0);
    } finally {
      await scenario.dispose();
    }
  });
  it("requires all three trainings, awards once, and shows the badge to the seminar instructor", async () => {
    const scenario = await createScenario();
    try {
      const member = sampleLtiRosterMember({
        userId: "seminar-student",
        email: scenario.learnerEmail.toUpperCase(),
      });
      const instructorBadges = () =>
        ltiRosterIssuedBadgeStatesByUserId({
          db: scenario.db,
          action: { tenantId: scenario.tenantId, badgeTemplateId: scenario.finalBadgeTemplateId },
          learnerMembers: [member],
        });
      expect(await scenario.jobs()).toHaveLength(0);
      for (const badge of scenario.requiredBadges.slice(0, 2))
        await scenario.awardTraining(badge.badgeTemplateId);
      expect((await scenario.evaluate()).result).toBe("in_progress");
      expect(await scenario.jobs()).toHaveLength(0);
      expect((await instructorBadges()).size).toBe(0);
      expect(
        await evaluateLtiRosterMemberEligibility({
          db: scenario.db,
          tenantId: scenario.tenantId,
          member,
          issuedState: null,
          nowIso: new Date().toISOString(),
          ruleResolution: { status: "resolved", ruleId: scenario.seminarRuleId },
        }),
      ).toMatchObject({ status: "not_yet_eligible", eligibleForIssuance: false });
      const lastBadge = scenario.requiredBadges[2];
      if (lastBadge === undefined) throw new Error("Three training requirements must exist");
      await scenario.awardTraining(lastBadge.badgeTemplateId);
      await Promise.all([scenario.evaluate(), scenario.evaluate()]);
      const jobs = await scenario.jobs();
      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      if (job === undefined) throw new Error("Completion must enqueue an award");
      expect((await scenario.progress())[0]?.state._tag).toBe("issuing");
      expect(
        String(
          await DashboardPathways({ pathways: await scenario.progress(), recordPath: "/record" }),
        ),
      ).not.toContain("View your final badge");
      const input = {
        db: scenario.db,
        tenantId: scenario.tenantId,
        ...job.payload,
        issueBadge: scenario.issueBadge,
      };
      expect(await processLearnerPathwayAward(input)).toEqual({ status: "issued" });
      expect(await processLearnerPathwayAward(input)).toEqual({ status: "skipped" });
      await scenario.evaluate();
      expect(await scenario.jobs()).toHaveLength(1);
      const progress = await scenario.progress();
      expect(progress[0]?.state._tag).toBe("issued");
      expect(
        String(await DashboardPathways({ pathways: progress, recordPath: "/record" })),
      ).toContain("View your final badge");
      const states = await instructorBadges();
      const issuedState = states.get(member.userId) ?? null;
      expect(issuedState?.lifecycleState).toBe("active");
      expect(
        await evaluateLtiRosterMemberEligibility({
          db: scenario.db,
          tenantId: scenario.tenantId,
          member,
          issuedState,
          nowIso: new Date().toISOString(),
          ruleResolution: { status: "resolved", ruleId: scenario.seminarRuleId },
        }),
      ).toMatchObject({ status: "already_issued", eligibleForIssuance: false });
      const count = await scenario.db
        .prepare(
          "SELECT COUNT(*)::int AS count FROM assertions WHERE tenant_id = ? AND badge_template_id = ?",
        )
        .bind(scenario.tenantId, scenario.finalBadgeTemplateId)
        .first<{ count: number }>();
      expect(count?.count).toBe(1);
    } finally {
      await scenario.dispose();
    }
  });

  it("rejects another tenant, rechecks revoked evidence, and retries after replacement evidence", async () => {
    const scenario = await createScenario();
    try {
      const assertions = await Promise.all(
        scenario.requiredBadges.map((badge) => scenario.awardTraining(badge.badgeTemplateId)),
      );
      await scenario.evaluate();
      const job = (await scenario.jobs())[0];
      const revokedId = assertions[0];
      const firstBadge = scenario.requiredBadges[0];
      if (job === undefined || revokedId === undefined || firstBadge === undefined)
        throw new Error("Expected completed scenario");
      const input = {
        db: scenario.db,
        tenantId: scenario.tenantId,
        ...job.payload,
        issueBadge: scenario.issueBadge,
      };
      expect(await processLearnerPathwayAward({ ...input, tenantId: "other-tenant" })).toEqual({
        status: "skipped",
      });
      await recordAssertionRevocation(scenario.db, {
        tenantId: scenario.tenantId,
        assertionId: revokedId,
        revocationId: uniqueTestId("rev"),
        idempotencyKey: uniqueTestId("revkey"),
        reason: "Training evidence withdrawn",
        revokedAt: new Date().toISOString(),
      });
      expect(await processLearnerPathwayAward(input)).toEqual({ status: "skipped" });
      expect((await scenario.progress())[0]?.state._tag).toBe("invalidated");
      await scenario.awardTraining(firstBadge.badgeTemplateId);
      await scenario.evaluate();
      expect(await scenario.jobs()).toHaveLength(2);
      expect(await processLearnerPathwayAward(input)).toEqual({ status: "issued" });
      expect((await scenario.progress())[0]?.state._tag).toBe("issued");
    } finally {
      await scenario.dispose();
    }
  });
});
