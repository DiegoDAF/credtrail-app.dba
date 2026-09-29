import { expect, it } from "vitest";
import type { ImmutableCredentialStore } from "@credtrail/core-domain";
import {
  activateBadgeIssuanceRuleVersion,
  findAssertionById,
  findBadgeAwardCycle,
  listAssertionLifecycleStatesByAssertionIds,
  recordAssertionLifecycleTransition,
  listLearnerBadgeSummaries,
} from "@credtrail/db";
import { parseBadgeIssuanceRuleDefinition, parseQueueJob } from "@credtrail/validation";
import {
  cleanupTestResources,
  createBadgeRuleIntegrationFixture,
  describeDbIntegration,
} from "../../../../packages/db/src/postgres-test-support";
import { createTestBadgeIssuanceRule } from "../../../../packages/db/src/badge-issuance-rule-test-fixtures";
import { createIssueBadgeForTenant } from "./direct-issue";
import { storeBadgeTemplateImage, badgeTemplateImagePublicPath } from "./template-image-storage";
import { processAutomatedBadgeRule } from "./automated-badge-rule-processor";
import { evaluateBadgeRuleLearner } from "../rules/badge-rule-learner-evaluator";
import type { GradebookAutomatedEvaluationReader } from "../lms/gradebook-types";
import { badgeAwardIdempotencyKey } from "./badge-award-identity";
import type { DirectIssueBadgeRequest } from "./recipient-identifiers";
import { evaluateLtiRosterMembersEligibility } from "../lti/roster-eligibility";
import { ltiRosterIssuedBadgeStatesByUserId } from "../lti/roster-issuance-helpers";
import { buildLtiRosterIssueBadgeRequest } from "../lti/roster-issue-request";
import { sampleLtiRosterMember } from "../lti/roster-eligibility-test-fixtures";

const sha256Hex = async (value: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const memoryStore = (): ImmutableCredentialStore => {
  const values = new Map<string, string>();
  return {
    head: (key) => Promise.resolve(values.has(key) ? { key } : null),
    get: (key) => {
      const value = values.get(key);
      return Promise.resolve(
        value === undefined ? null : { size: value.length, text: () => Promise.resolve(value) },
      );
    },
    put: (key, value) => {
      values.set(key, value);
      return Promise.resolve({
        key,
        etag: "test",
        version: "test",
        size: value.length,
        uploaded: new Date(),
      });
    },
    delete: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
  };
};

const scenario = async (manual = false) => {
  const fixture = await createBadgeRuleIntegrationFixture();
  const store = memoryStore();
  const ids = {
    tenantId: fixture.tenantId,
    badgeTemplateId: fixture.badgeTemplateId,
    assetId: "renewal-art",
  };
  await storeBadgeTemplateImage(store, {
    ...ids,
    mimeType: "image/png",
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    originalFilename: null,
  });
  await fixture.db
    .prepare("UPDATE badge_templates SET image_uri = ? WHERE id = ?")
    .bind(`https://credtrail.org${badgeTemplateImagePublicPath(ids)}`, fixture.badgeTemplateId)
    .run();
  const definition = parseBadgeIssuanceRuleDefinition({
    conditions: manual
      ? {
          type: "instructor_confirmation",
          instructions: "Confirm the learner completed this year's training.",
        }
      : {
          type: "assignment_submission",
          courseId: "training",
          assignmentId: "assessment",
          minScore: 80,
        },
    options: { issuanceTiming: manual ? "manual" : "immediate", renewal: { intervalMonths: 12 } },
  });
  const created = await createTestBadgeIssuanceRule(fixture.db, {
    tenantId: fixture.tenantId,
    name: "Annual training",
    badgeTemplateId: fixture.badgeTemplateId,
    lmsProviderKind: "canvas",
    lmsConnectionId: fixture.lmsConnectionId,
    createdByUserId: fixture.userId,
    ruleJson: JSON.stringify(definition),
  });
  await fixture.db
    .prepare("UPDATE badge_issuance_rule_versions SET status = 'approved' WHERE id = ?")
    .bind(created.version.id)
    .run();
  await activateBadgeIssuanceRuleVersion(fixture.db, {
    tenantId: fixture.tenantId,
    ruleId: created.rule.id,
    versionId: created.version.id,
    actorUserId: fixture.userId,
    activatedAt: "2020-01-01T00:00:00.000Z",
  });
  class IssuanceError extends Error {
    public constructor(
      public readonly statusCode: number,
      public readonly payload: { error: string },
    ) {
      super(payload.error);
    }
  }
  const issue = createIssueBadgeForTenant({
    resolveDatabase: () => fixture.db,
    signCredentialForDid: (request) =>
      Promise.resolve({
        status: "ok",
        keyId: "test",
        verificationMethod: "test",
        credential: request.credential,
      }),
    sendIssuanceEmailNotification: () => Promise.resolve(),
    observabilityContext: () => ({ service: "renewal-test", environment: "test" }),
    publicBadgePathForAssertion: (assertion) => `/badges/${assertion.publicId ?? assertion.id}`,
    HttpErrorResponseClass: IssuanceError,
  });
  const context = {
    env: {
      BADGE_OBJECTS: store,
      PLATFORM_DOMAIN: "credtrail.org",
      PUBLIC_APP_ORIGIN: "https://credtrail.org",
    },
    req: { url: "https://credtrail.org" },
  };
  const email = `${fixture.userId}@example.edu`;
  const provider = (
    submittedAt: string,
    score = 95,
    gradedAt = submittedAt,
  ): GradebookAutomatedEvaluationReader => ({
    listLearners: () =>
      Promise.resolve([
        { courseId: "training", learnerId: "student", displayName: "Learner", email },
      ]),
    listGrades: () => Promise.resolve([]),
    listCompletions: () => Promise.resolve([]),
    listSubmissions: () =>
      Promise.resolve([
        {
          courseId: "training",
          assignmentId: "assessment",
          learnerId: "student",
          workflowState: "graded",
          score,
          submittedAt,
          gradedAt,
          missing: false,
          late: false,
        },
      ]),
  });
  const issueAt = (request: DirectIssueBadgeRequest, issuedAt: string) =>
    issue(context, fixture.tenantId, request, fixture.userId, { issuedAt });
  const requestFor = async (
    submittedAt: string,
    evaluatedAt: string,
    previousId?: string,
  ): Promise<DirectIssueBadgeRequest> => {
    const result = await evaluateBadgeRuleLearner({
      db: fixture.db,
      tenantId: fixture.tenantId,
      lmsProviderKind: "canvas",
      learnerId: "student",
      recipientEmail: email,
      definition,
      nowIso: evaluatedAt,
      gradebookProvider: provider(submittedAt),
    });
    if (result.status !== "evaluated") throw new Error("Expected evaluation");
    return {
      recipientIdentity: email,
      recipientIdentityType: "email",
      idempotencyKey: await badgeAwardIdempotencyKey({
        tenantId: fixture.tenantId,
        badgeTemplateId: fixture.badgeTemplateId,
        recipientEmail: email,
        renewalOfAssertionId: previousId,
        sha256Hex,
      }),
      achievementSource: {
        kind: "rule_version",
        provenance: {
          source: "rule_evaluate",
          ruleId: created.rule.id,
          versionId: created.version.id,
          provenanceJson: result.provenanceJson,
        },
      },
    };
  };
  return {
    ...fixture,
    definition,
    created,
    email,
    provider,
    issueAt,
    requestFor,
    dispose: () =>
      cleanupTestResources(fixture.db, {
        tenantIds: [fixture.tenantId],
        userIds: [fixture.userId],
      }),
  };
};

describeDbIntegration("rolling badge renewals", () => {
  it("signs expiry, rejects stale evidence, preserves history and awards once per new completion", async () => {
    const s = await scenario();
    try {
      const firstRequest = await s.requestFor(
        "2020-01-30T10:00:00.000Z",
        "2020-01-31T10:00:00.000Z",
      );
      const first = await s.issueAt(firstRequest, "2020-01-31T10:00:00.000Z");
      expect(first.credential.validUntil).toBe("2021-01-31T10:00:00.000Z");
      const persisted = await findAssertionById(s.db, s.tenantId, first.assertionId);
      expect(persisted).toMatchObject({
        validUntil: first.credential.validUntil,
        renewalOfAssertionId: null,
      });
      expect(
        await listAssertionLifecycleStatesByAssertionIds(s.db, {
          tenantId: s.tenantId,
          assertionIds: [first.assertionId],
        }),
      ).toMatchObject([{ state: "expired", source: "validity_period" }]);
      const pendingExpiry = await s.db
        .prepare(
          "SELECT available_at AS availableAt FROM job_queue_messages WHERE tenant_id = ? AND idempotency_key = ?",
        )
        .bind(s.tenantId, `assertion_status_changed:expiry:${first.assertionId}`)
        .first<{ availableAt: string }>();
      expect(pendingExpiry?.availableAt).toBe("2021-01-31T10:00:00.000Z");
      const now = new Date().toISOString();
      const stale = await s.requestFor("2020-01-30T10:00:00.000Z", now, first.assertionId);
      await expect(s.issueAt(stale, now)).rejects.toThrow("new training completion");
      const fresh = await s.requestFor("2026-01-01T10:00:00.000Z", now, first.assertionId);
      const results = await Promise.allSettled([
        s.issueAt(fresh, now),
        s.issueAt({ ...fresh, idempotencyKey: "concurrent-other-course" }, now),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const renewed = await findBadgeAwardCycle(s.db, {
        tenantId: s.tenantId,
        badgeTemplateId: s.badgeTemplateId,
        recipientEmail: s.email.toUpperCase(),
      });
      expect(renewed?.state).toBe("active");
      expect(renewed?.assertionId).not.toBe(first.assertionId);
      if (renewed === null) throw new Error("Expected renewal");
      expect(await findAssertionById(s.db, s.tenantId, renewed.assertionId)).toMatchObject({
        renewalOfAssertionId: first.assertionId,
      });
      const count = await s.db
        .prepare("SELECT COUNT(*)::int AS count FROM assertions WHERE tenant_id = ?")
        .bind(s.tenantId)
        .first<{ count: number }>();
      expect(count?.count).toBe(2);
      await expect(s.issueAt({ ...fresh, idempotencyKey: "another-attempt" }, now)).rejects.toThrow(
        "already has a current badge",
      );
      expect(
        await findBadgeAwardCycle(s.db, {
          tenantId: "other-tenant",
          badgeTemplateId: s.badgeTemplateId,
          recipientEmail: s.email,
        }),
      ).toBeNull();
    } finally {
      await s.dispose();
    }
  });

  it("queues a fresh automatic renewal once and rejects an old score or a suspended award", async () => {
    const s = await scenario();
    try {
      const first = await s.issueAt(
        await s.requestFor("2020-01-01T00:00:00.000Z", "2020-01-02T00:00:00.000Z"),
        "2020-01-02T00:00:00.000Z",
      );
      const now = new Date().toISOString();
      const run = (provider: GradebookAutomatedEvaluationReader) =>
        processAutomatedBadgeRule({
          db: s.db,
          tenantId: s.tenantId,
          payload: {
            ruleId: s.created.rule.id,
            versionId: s.created.version.id,
            scheduledFor: now,
          },
          sha256Hex,
          gradebookProvider: provider,
        });
      expect(await run(s.provider("2020-01-01T00:00:00.000Z"))).toMatchObject({
        issueJobsEnqueued: 0,
      });
      expect(
        await run(s.provider("2026-01-01T00:00:00.000Z", 95, "2020-01-01T00:00:00.000Z")),
      ).toMatchObject({ issueJobsEnqueued: 0 });
      expect(await run(s.provider("2026-01-01T00:00:00.000Z", 50))).toMatchObject({
        issueJobsEnqueued: 0,
      });
      expect(await run(s.provider("2026-01-01T00:00:00.000Z"))).toMatchObject({
        issueJobsEnqueued: 1,
      });
      expect(await run(s.provider("2026-01-01T00:00:00.000Z"))).toMatchObject({
        issueJobsEnqueued: 0,
      });
      const row = await s.db
        .prepare(
          "SELECT payload_json AS payloadJson, idempotency_key AS idempotencyKey FROM job_queue_messages WHERE tenant_id = ? AND job_type = 'issue_badge'",
        )
        .bind(s.tenantId)
        .first<{ payloadJson: string; idempotencyKey: string }>();
      if (row === null) throw new Error("Expected renewal job");
      const job = parseQueueJob({
        tenantId: s.tenantId,
        jobType: "issue_badge",
        payload: JSON.parse(row.payloadJson),
        idempotencyKey: row.idempotencyKey,
      });
      expect(job.jobType).toBe("issue_badge");
      // A suspension still blocks renewal when the date has expired.
      await s.db
        .prepare("UPDATE assertions SET valid_until = ? WHERE id = ?")
        .bind("2030-01-01T00:00:00.000Z", first.assertionId)
        .run();
      await recordAssertionLifecycleTransition(s.db, {
        tenantId: s.tenantId,
        assertionId: first.assertionId,
        toState: "suspended",
        reasonCode: "administrative_hold",
        transitionSource: "manual",
        actorUserId: s.userId,
        transitionedAt: now,
      });
      await s.db
        .prepare("UPDATE assertions SET valid_until = ? WHERE id = ?")
        .bind("2021-01-02T00:00:00.000Z", first.assertionId)
        .run();
      expect(await run(s.provider("2026-01-01T00:00:00.000Z"))).toMatchObject({
        issueJobsEnqueued: 0,
      });
      await expect(
        s.issueAt(await s.requestFor("2026-01-01T00:00:00.000Z", now, first.assertionId), now),
      ).rejects.toThrow("suspension or revocation");
    } finally {
      await s.dispose();
    }
  });

  it("keeps rule exclusions when older evidence is removed from the renewal check", async () => {
    const s = await scenario();
    try {
      const result = await evaluateBadgeRuleLearner({
        db: s.db,
        tenantId: s.tenantId,
        lmsProviderKind: "canvas",
        learnerId: "student",
        recipientEmail: s.email,
        nowIso: new Date().toISOString(),
        previousIssuedAt: "2020-01-02T00:00:00.000Z",
        definition: parseBadgeIssuanceRuleDefinition({
          conditions: {
            all: [
              s.definition.conditions,
              {
                not: {
                  type: "course_completion",
                  courseId: "excluded-course",
                  minCompletionPercent: 100,
                },
              },
            ],
          },
          options: { renewal: { intervalMonths: 12 } },
        }),
        gradebookProvider: {
          ...s.provider("2026-01-01T00:00:00.000Z"),
          listCompletions: ({ courseId }) =>
            Promise.resolve(
              courseId === "excluded-course"
                ? [
                    {
                      courseId,
                      learnerId: "student",
                      completed: true,
                      completedAt: "2019-01-01T00:00:00.000Z",
                      evidenceFrom: "2019-01-01T00:00:00.000Z",
                      completionPercent: 100,
                      sourceState: "gradebook_items",
                    },
                  ]
                : [],
            ),
        },
      });
      expect(result).toMatchObject({ status: "evaluated", evaluation: { matched: false } });
    } finally {
      await s.dispose();
    }
  });

  it("lets an instructor confirm a new cycle from another course and exposes renewal due", async () => {
    const s = await scenario(true);
    try {
      const member = sampleLtiRosterMember({ userId: "student", email: s.email });
      const states = () =>
        ltiRosterIssuedBadgeStatesByUserId({
          db: s.db,
          action: { tenantId: s.tenantId, badgeTemplateId: s.badgeTemplateId },
          learnerMembers: [member],
        });
      const eligibility = async (nowIso: string) =>
        (
          await evaluateLtiRosterMembersEligibility({
            db: s.db,
            tenantId: s.tenantId,
            ruleResolution: { status: "resolved", ruleId: s.created.rule.id },
            members: [member],
            issuedStatesByUserId: await states(),
            nowIso,
            confirmedByUserId: s.userId,
          })
        ).get(member.userId);
      const firstEligibility = await eligibility("2020-01-01T00:00:00.000Z");
      if (firstEligibility === undefined) throw new Error("Expected learner");
      const build = (value: typeof firstEligibility) =>
        buildLtiRosterIssueBadgeRequest({
          member: { ...member, email: s.email },
          eligibility: value,
          tenantId: s.tenantId,
          badgeTemplateId: s.badgeTemplateId,
          sha256Hex,
        });
      const first = await s.issueAt(await build(firstEligibility), "2020-01-01T00:00:00.000Z");
      const now = new Date().toISOString();
      const renewalEligibility = await eligibility(now);
      expect(renewalEligibility).toMatchObject({
        eligibleForIssuance: true,
        label: "Ready to renew",
        renewalOfAssertionId: first.assertionId,
      });
      if (renewalEligibility === undefined) throw new Error("Expected renewal eligibility");
      const request = await build(renewalEligibility);
      const renewal = await s.issueAt(request, now);
      expect(renewal.status).toBe("issued");
      expect((await s.issueAt(request, now)).status).toBe("already_issued");
      expect((await states()).get(member.userId)?.lifecycleState).toBe("active");
      // Connect the login email to the issued learner for the real dashboard query.
      await s.db.prepare("UPDATE users SET email = ? WHERE id = ?").bind(s.email, s.userId).run();
      expect(
        await listLearnerBadgeSummaries(s.db, { tenantId: s.tenantId, userId: s.userId }),
      ).toMatchObject([{ lifecycleState: "active" }, { lifecycleState: "expired" }]);
    } finally {
      await s.dispose();
    }
  });
});
