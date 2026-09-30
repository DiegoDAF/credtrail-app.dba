import { expect, it } from "vitest";
import { activateBadgeIssuanceRuleVersion } from "@credtrail/db";
import { parseIssuanceEvidenceSnapshotJson, parseQueueJob } from "@credtrail/validation";
import {
  createBadgeRuleIntegrationFixture,
  cleanupTestResources,
  describeDbIntegration,
} from "../../../../packages/db/src/postgres-test-support";
import { createTestBadgeIssuanceRule } from "../../../../packages/db/src/badge-issuance-rule-test-fixtures";
import { createCanvasGradebookProvider } from "../lms/canvas-gradebook-provider";
import type {
  GradebookAutomatedEvaluationReader,
  GradebookLearnerRecord,
} from "../lms/gradebook-types";
import { processAutomatedBadgeRule } from "../badges/automated-badge-rule-processor";
import { evaluateLtiRosterMembersEligibility } from "./roster-eligibility";
import { sampleLtiRosterMember } from "./roster-eligibility-test-fixtures";

const NOW = "2026-09-30T12:00:00.000Z";
const sha256Hex = async (value: string): Promise<string> =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString(
    "hex",
  );

const setup = async () => {
  const fixture = await createBadgeRuleIntegrationFixture();
  const created = await createTestBadgeIssuanceRule(fixture.db, {
    tenantId: fixture.tenantId,
    name: "Master training",
    badgeTemplateId: fixture.badgeTemplateId,
    lmsProviderKind: "canvas",
    lmsConnectionId: fixture.lmsConnectionId,
    createdByUserId: fixture.userId,
    ruleJson: JSON.stringify({
      conditions: {
        type: "assignment_submission",
        courseId: "master",
        assignmentId: "exam",
        minScore: 80,
      },
      options: { renewal: {} },
    }),
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
    activatedAt: "2026-01-01T00:00:00.000Z",
  });
  return { ...fixture, created };
};

describeDbIntegration("instructor checks of master-course rules", () => {
  it("evaluates a completed learner beyond page one and recognizes them in another course's roster", async () => {
    const fixture = await setup();
    try {
      const requests: URL[] = [];
      const provider = createCanvasGradebookProvider({
        config: {
          kind: "canvas",
          apiBaseUrl: "https://canvas.example.edu",
          accessToken: "test-token",
        },
        fetchImpl: async (input) => {
          const url = new URL(input instanceof Request ? input.url : input);
          requests.push(url);
          const learnerId = Number(url.searchParams.get("student_ids[]"));
          const isRoster = url.pathname.endsWith("/users");
          const isFirst = !url.searchParams.has("page");
          const includesCompleted = url.searchParams
            .getAll("enrollment_state[]")
            .includes("completed");
          const body = isRoster
            ? isFirst
              ? Array.from({ length: 100 }, (_, index) => ({
                  id: index + 1,
                  name: `Learner ${index + 1}`,
                  email: `learner${index + 1}@example.edu`,
                }))
              : includesCompleted
                ? [{ id: 101, name: "Learner 101", email: "last@example.edu" }]
                : []
            : url.pathname.endsWith("/students/submissions")
              ? [
                  {
                    user_id: learnerId,
                    assignment_id: "exam",
                    score: learnerId === 101 ? 95 : 40,
                    workflow_state: "graded",
                    submitted_at: "2026-09-20T12:00:00.000Z",
                    graded_at: "2026-09-21T12:00:00.000Z",
                    grade_matches_current_submission: true,
                  },
                ]
              : [];
          return new Response(JSON.stringify(body), {
            headers: {
              "content-type": "application/json",
              ...(isRoster && isFirst
                ? {
                    link: `<${url.toString()}&page=2>; rel="next"`,
                  }
                : {}),
            },
          });
        },
      });
      const automatic = await processAutomatedBadgeRule({
        db: fixture.db,
        tenantId: fixture.tenantId,
        payload: {
          ruleId: fixture.created.rule.id,
          versionId: fixture.created.version.id,
          scheduledFor: NOW,
        },
        sha256Hex,
        gradebookProvider: provider,
      });
      expect(automatic).toMatchObject({
        status: "processed",
        candidateLearnerCount: 101,
        issueJobsEnqueued: 1,
      });
      const jobs = await fixture.db
        .prepare(
          "SELECT payload_json AS payload, idempotency_key AS idempotencyKey FROM job_queue_messages WHERE tenant_id = ? AND job_type = 'issue_badge'",
        )
        .bind(fixture.tenantId)
        .all<{ payload: string; idempotencyKey: string }>();
      const job = parseQueueJob({
        jobType: "issue_badge",
        tenantId: fixture.tenantId,
        payload: JSON.parse(jobs.results[0]?.payload ?? "null"),
        idempotencyKey: jobs.results[0]?.idempotencyKey,
      });
      expect(job).toMatchObject({
        jobType: "issue_badge",
        payload: { recipientIdentity: "last@example.edu" },
      });
      const rosterRequestsBefore = requests.filter((url) => url.pathname.endsWith("/users")).length;
      const members = [
        sampleLtiRosterMember({ userId: "opaque-lti-101", email: " LAST@example.edu " }),
        sampleLtiRosterMember({ userId: "opaque-lti-1", email: "learner1@example.edu" }),
      ];
      const eligibility = await evaluateLtiRosterMembersEligibility({
        db: fixture.db,
        tenantId: fixture.tenantId,
        ruleResolution: { status: "resolved", ruleId: fixture.created.rule.id },
        members,
        issuedStatesByUserId: new Map(),
        nowIso: NOW,
        gradebookProvider: provider,
      });
      const eligible = eligibility.get("opaque-lti-101");
      expect(eligible?.status).toBe("eligible");
      expect(eligibility.get("opaque-lti-1")?.status).toBe("not_yet_eligible");
      const evidence = parseIssuanceEvidenceSnapshotJson(
        eligible?.issuanceProvenance?.provenanceJson ?? null,
      );
      expect(evidence.facts?.learnerId).toBe("101");
      expect(
        requests.filter((url) => url.pathname.endsWith("/users")).length - rosterRequestsBefore,
      ).toBe(2);
      expect(
        requests.some((url) => url.searchParams.get("student_ids[]")?.startsWith("opaque")),
      ).toBe(false);

      const foreignFixture = await createBadgeRuleIntegrationFixture();
      try {
        const foreign = await evaluateLtiRosterMembersEligibility({
          db: foreignFixture.db,
          tenantId: foreignFixture.tenantId,
          ruleResolution: { status: "resolved", ruleId: fixture.created.rule.id },
          members,
          issuedStatesByUserId: new Map(),
          nowIso: NOW,
          gradebookProvider: provider,
        });
        expect(foreign.get("opaque-lti-101")?.status).toBe("rule_pending");
      } finally {
        await cleanupTestResources(foreignFixture.db, {
          tenantIds: [foreignFixture.tenantId],
          userIds: [foreignFixture.userId],
        });
      }
    } finally {
      await cleanupTestResources(fixture.db, {
        tenantIds: [fixture.tenantId],
        userIds: [fixture.userId],
      });
    }
  });

  it("fails closed on missing, ambiguous, or incomplete roster identities while preserving existing awards", async () => {
    const fixture = await setup();
    try {
      const learner = (id: string, email: string): GradebookLearnerRecord => ({
        courseId: "master",
        learnerId: id,
        email,
        displayName: id,
      });
      let rows: readonly GradebookLearnerRecord[] = [];
      let failRead = false;
      const factReads: string[] = [];
      const provider: GradebookAutomatedEvaluationReader = {
        listLearners: () =>
          failRead ? Promise.reject(new Error("roster unavailable")) : Promise.resolve(rows),
        listGrades: () => {
          factReads.push("grades");
          return Promise.resolve([]);
        },
        listCompletions: () => {
          factReads.push("completions");
          return Promise.resolve([]);
        },
        listSubmissions: () => {
          factReads.push("submissions");
          return Promise.resolve([]);
        },
      };
      const check = () =>
        evaluateLtiRosterMembersEligibility({
          db: fixture.db,
          tenantId: fixture.tenantId,
          ruleResolution: { status: "resolved", ruleId: fixture.created.rule.id },
          members: [
            sampleLtiRosterMember({ userId: "42", email: "target@example.edu" }),
            sampleLtiRosterMember({ userId: "current", email: "current@example.edu" }),
          ],
          issuedStatesByUserId: new Map([
            ["current", { assertionId: "existing", issuedAt: NOW, lifecycleState: "active" }],
          ]),
          nowIso: NOW,
          gradebookProvider: provider,
        });
      for (const invalidRows of [
        [learner("42", "someone-else@example.edu")],
        [learner("42", "target@example.edu"), learner("43", "target@example.edu")],
        [learner("42", "target@example.edu"), learner("42", "another@example.edu")],
      ]) {
        rows = invalidRows;
        const result = await check();
        expect(result.get("42")?.status).toBe("unavailable");
        expect(result.get("current")?.status).toBe("already_issued");
      }
      failRead = true;
      expect((await check()).get("42")?.status).toBe("unavailable");
      expect(factReads).toEqual([]);
    } finally {
      await cleanupTestResources(fixture.db, {
        tenantIds: [fixture.tenantId],
        userIds: [fixture.userId],
      });
    }
  });
});
