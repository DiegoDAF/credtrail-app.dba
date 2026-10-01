import { afterEach, beforeEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { createFakeLtiAdvantage } from "@longsightgroup/lti-tool/testing";
import {
  resolveLtiNrpsRoster,
  LTI_CLAIM_VERSION,
  LTI_CLAIM_DEPLOYMENT_ID,
  LTI_CLAIM_TARGET_LINK_URI,
  LTI_CLAIM_MESSAGE_TYPE,
  type LTISession,
  type LtiServiceResult,
  type Member,
  type NrpsMembersResult,
} from "@longsightgroup/lti-tool";
import {
  findLtiResourceLinkPlacement,
  placeStableLtiBadgeRule,
  replaceBadgeRulePlacementAvailability,
  retireLtiResourceLinkPlacement,
  upsertCatalogLmsCourseContext,
  type SqlDatabase,
} from "@credtrail/db";
import { createFixtureRule } from "../../../../packages/db/src/badge-issuance-rule-test-fixtures";
import {
  cleanupTestResources,
  createBadgeRuleIntegrationFixture,
  describeDbIntegration,
  seedAssertion,
  type BadgeRuleIntegrationFixture,
} from "../../../../packages/db/src/postgres-test-support";
import type { AppEnv } from "../app/types";
import type { DirectIssueBadgeRequest } from "../badges/recipient-identifiers";
import { executeLtiRosterIssuance } from "./roster-issuance";
import type { LtiIssuanceActionPayload } from "./issuance-action-token";
import { ltiRosterIssuedBadgeStatesByUserId } from "./roster-issuance-helpers";

const issuer = "https://institution.example.edu";
const sha256Hex = async (value: string): Promise<string> =>
  createHash("sha256").update(value).digest("hex");
const learner = {
  userId: "learner-1",
  email: "learner@example.edu",
  name: "Learner One",
  roles: ["Learner"],
  status: "Active" as const,
};
const definition = {
  conditions: {
    type: "instructor_confirmation",
    instructions:
      "Complete Library Orientation and discuss the final exercise with your instructor.",
  },
  options: { issuanceTiming: "manual" },
};

const rosterReader = (members: Member[]) => {
  function getMembers(): Promise<LtiServiceResult<Member[]>>;
  function getMembers(options: {
    readonly followPagination?: false | undefined;
  }): Promise<LtiServiceResult<Member[]>>;
  function getMembers(options: {
    readonly followPagination: true;
    readonly maxPages?: number;
  }): Promise<LtiServiceResult<NrpsMembersResult>>;
  async function getMembers(options?: {
    readonly followPagination?: boolean | undefined;
    readonly maxPages?: number;
  }): Promise<LtiServiceResult<Member[]> | LtiServiceResult<NrpsMembersResult>> {
    if (options?.followPagination === true) throw new Error("Unexpected pagination request");
    return { success: true, data: members };
  }
  return getMembers;
};

const sessionFor = (action: LtiIssuanceActionPayload): LTISession => ({
  id: action.ltiSessionId,
  jwtPayload: {
    iss: issuer,
    sub: "instructor",
    aud: "client",
    exp: 2000000000,
    iat: 1700000000,
    nonce: "test",
    [LTI_CLAIM_VERSION]: "1.3.0",
    [LTI_CLAIM_DEPLOYMENT_ID]: "deployment",
    [LTI_CLAIM_TARGET_LINK_URI]: "https://credtrail.example.edu/v1/lti/launch",
    [LTI_CLAIM_MESSAGE_TYPE]: "LtiResourceLinkRequest",
  },
  user: { id: "instructor", roles: ["Instructor"] },
  context: { id: action.contextId, title: action.contextId, label: action.contextId },
  platform: { issuer, clientId: "client", deploymentId: "deployment", name: "LMS" },
  launch: { target: "https://credtrail.example.edu/v1/lti/launch" },
  resourceLink: { id: action.resourceLinkId },
  customParameters: {},
  isAdmin: false,
  isInstructor: true,
  isStudent: false,
  isAssignmentAndGradesAvailable: false,
  isDeepLinkingAvailable: false,
  isNameAndRolesAvailable: true,
});

const place = async (
  db: SqlDatabase,
  fixture: BadgeRuleIntegrationFixture,
  action: LtiIssuanceActionPayload,
): Promise<void> => {
  await upsertCatalogLmsCourseContext(db, {
    tenantId: fixture.tenantId,
    lmsConnectionId: fixture.lmsConnectionId,
    contextId: action.contextId,
    displayName: action.contextId,
    courseCode: null,
    createdByUserId: fixture.userId,
  });
  const result = await placeStableLtiBadgeRule(db, {
    tenantId: fixture.tenantId,
    lmsConnectionId: fixture.lmsConnectionId,
    contextId: action.contextId,
    issuer,
    clientId: "client",
    deploymentId: "deployment",
    resourceLinkId: action.resourceLinkId,
    incomingRuleId: action.ruleId,
    incomingBadgeTemplateId: action.badgeTemplateId,
    linkedUserId: fixture.userId,
    roleKind: "instructor",
  });
  expect(result.status).toBe("placed");
};

describeDbIntegration("institution-wide instructor issuance", () => {
  let fixture: BadgeRuleIntegrationFixture;
  let action: LtiIssuanceActionPayload;
  let requests: DirectIssueBadgeRequest[];

  beforeEach(async () => {
    fixture = await createBadgeRuleIntegrationFixture();
    requests = [];
    const created = await createFixtureRule(fixture);
    await fixture.db
      .prepare(
        "UPDATE tenant_lms_connections SET lti_issuer = ?, lti_client_id = 'client', lti_deployment_id = 'deployment' WHERE tenant_id = ? AND id = ?",
      )
      .bind(issuer, fixture.tenantId, fixture.lmsConnectionId)
      .run();
    await fixture.db
      .prepare(
        "UPDATE badge_issuance_rule_versions SET rule_json = ?, status = 'active', effective_starts_at = '2026-01-01T00:00:00.000Z' WHERE tenant_id = ? AND id = ?",
      )
      .bind(JSON.stringify(definition), fixture.tenantId, created.version.id)
      .run();
    await fixture.db
      .prepare(
        "UPDATE badge_issuance_rules SET active_version_id = ? WHERE tenant_id = ? AND id = ?",
      )
      .bind(created.version.id, fixture.tenantId, created.rule.id)
      .run();
    const availability = await replaceBadgeRulePlacementAvailability(fixture.db, {
      tenantId: fixture.tenantId,
      ruleId: created.rule.id,
      actorUserId: fixture.userId,
      actorRole: "admin",
      availability: { scope: "tenant" },
    });
    if (availability.status !== "updated")
      throw new Error("Fixture rule must be available institution-wide");
    action = {
      tenantId: fixture.tenantId,
      ltiSessionId: "session",
      issuer,
      clientId: "client",
      deploymentId: "deployment",
      contextId: "course-a",
      resourceLinkId: "link-a",
      badgeTemplateId: fixture.badgeTemplateId,
      ruleId: created.rule.id,
      versionId: created.version.id,
      issuedByUserId: fixture.userId,
      exp: 2000000000,
    };
    await place(fixture.db, fixture, action);
  });

  afterEach(async () => {
    await cleanupTestResources(fixture.db, {
      tenantIds: [fixture.tenantId],
      userIds: [fixture.userId],
    });
  });

  const issue = async (
    selected: readonly string[] = [learner.userId],
    currentAction: LtiIssuanceActionPayload = action,
    members = [learner],
  ): Promise<Response> => {
    const app = new Hono<AppEnv>();
    app.post("/issue", async (c) => {
      const outcome = await executeLtiRosterIssuance({
        c,
        db: fixture.db,
        ltiSession: sessionFor(currentAction),
        issuanceAction: currentAction,
        selectedLearnerUserIds: selected,
        sha256Hex,
        ltiTool: {
          createAdvantage: () => createFakeLtiAdvantage({ getMembers: rosterReader(members) }),
        },
        issueBadgeForTenant: async (_context, tenantId, request) => {
          requests.push(request);
          if (request.idempotencyKey === undefined) throw new Error("Missing idempotency key");
          const assertionId = await seedAssertion(fixture.db, {
            tenantId,
            badgeTemplateId: fixture.badgeTemplateId,
            recipientIdentity: request.recipientIdentity,
            issuedAt: new Date().toISOString(),
            idempotencyKey: request.idempotencyKey,
          });
          return {
            status: "issued",
            tenantId,
            assertionId,
            idempotencyKey: request.idempotencyKey,
            vcR2Key: "test",
            credential: {},
          };
        },
      });
      if (outcome.status !== "completed")
        return c.json(
          { error: outcome.detail },
          outcome.status === "denied" ? 403 : outcome.status === "rule_changed" ? 409 : 502,
        );
      return c.json(outcome.summary);
    });
    return app.request("https://credtrail.example.edu/issue", { method: "POST" });
  };

  it("issues without course evidence, records confirmation, and recognizes the badge in another course", async () => {
    const first = await issue();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ results: [{ status: "issued" }] });
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.achievementSource.kind).toBe("rule_version");
    if (request?.achievementSource.kind !== "rule_version")
      throw new Error("Missing governed issuance source");
    expect(JSON.parse(request.achievementSource.provenance.provenanceJson)).toMatchObject({
      facts: {
        instructorConfirmations: [
          {
            confirmedByUserId: fixture.userId,
            instructions: definition.conditions.instructions,
            confirmedAt: expect.any(String),
          },
        ],
      },
    });
    const secondAction = { ...action, contextId: "course-b", resourceLinkId: "link-b" };
    await place(fixture.db, fixture, secondAction);
    const second = await issue(["different-lms-id"], secondAction, [
      { ...learner, userId: "different-lms-id", email: "LEARNER@example.edu" },
    ]);
    expect(await second.json()).toMatchObject({ results: [{ status: "skipped" }] });
    expect(requests).toHaveLength(1);
    const states = await ltiRosterIssuedBadgeStatesByUserId({
      db: fixture.db,
      action: secondAction,
      learnerMembers: resolveLtiNrpsRoster([learner]).learnerMembers,
    });
    expect(states.get(learner.userId)?.lifecycleState).toBe("active");
  });

  it("does not issue to someone absent from the current roster", async () => {
    const response = await issue(["outside-roster"]);
    expect(await response.json()).toMatchObject({ results: [{ status: "skipped" }] });
    expect(requests).toHaveLength(0);
  });

  it("rejects a stale approved version", async () => {
    const response = await issue([learner.userId], { ...action, versionId: "stale-version" });
    expect(response.status).toBe(409);
    expect(requests).toHaveLength(0);
  });

  it("rejects a course after institutional availability is withdrawn", async () => {
    await fixture.db
      .prepare(
        "DELETE FROM badge_rule_placement_availabilities WHERE tenant_id = ? AND rule_id = ?",
      )
      .bind(fixture.tenantId, action.ruleId)
      .run();
    expect((await issue()).status).toBe(403);
    expect(requests).toHaveLength(0);
  });

  it("rejects a retired course placement", async () => {
    const placement = await findLtiResourceLinkPlacement(fixture.db, action);
    if (placement === null) throw new Error("Missing placement");
    await retireLtiResourceLinkPlacement(fixture.db, {
      tenantId: fixture.tenantId,
      ruleId: action.ruleId,
      placementId: placement.id,
      actorUserId: fixture.userId,
      actorRole: "admin",
    });
    expect((await issue()).status).toBe(403);
    expect(requests).toHaveLength(0);
  });

  it("does not allow manual issuing for automatically evaluated rules", async () => {
    await fixture.db
      .prepare(
        "UPDATE badge_issuance_rule_versions SET rule_json = ? WHERE tenant_id = ? AND id = ?",
      )
      .bind(
        JSON.stringify({
          conditions: {
            type: "course_completion",
            courseId: "orientation",
            minCompletionPercent: 100,
          },
          options: { issuanceTiming: "immediate" },
        }),
        fixture.tenantId,
        action.versionId,
      )
      .run();
    const response = await issue();
    expect(await response.json()).toMatchObject({ results: [{ status: "skipped" }] });
    expect(requests).toHaveLength(0);
  });
});
