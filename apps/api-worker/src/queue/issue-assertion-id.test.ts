import { describe, expect, it } from "vitest";
import { assertionIdForIssuance } from "../badges/direct-issue";
import { issueBadgeQueueJobFromRequest } from "./job-builders";
import { directIssueRequestFromQueueJob } from "./processing";

const achievementSource = {
  kind: "template_snapshot",
  snapshot: {
    badgeTemplateId: "badge_template_001",
    title: "Member",
    description: null,
    criteriaUri: null,
    imageUri: null,
    trustedCredentialMetadataJson: null,
  },
  provenance: { source: "programmatic" },
} as const;

describe("queued issuance keeps the assertion id returned to the API caller", () => {
  it("passes the id reserved at ingress through to issuance", () => {
    const { assertionId, job } = issueBadgeQueueJobFromRequest({
      tenantId: "tenant_123",
      recipientIdentity: "learner@example.edu",
      recipientIdentityType: "email",
      idempotencyKey: "idem-1",
      achievementSource,
    });
    const request = directIssueRequestFromQueueJob(job);

    expect(request.assertionId).toBe(assertionId);
    expect(assertionIdForIssuance(request.assertionId, "tenant_123")).toBe(assertionId);
  });

  it("only keeps an id scoped to the same tenant", () => {
    expect(assertionIdForIssuance("tenant_123:abc", "tenant_123")).toBe("tenant_123:abc");

    for (const requested of [undefined, "other_tenant:abc", "tenant_123:", "tenant_1234:abc"]) {
      const assertionId = assertionIdForIssuance(requested, "tenant_123");

      expect(assertionId).not.toBe(requested);
      expect(assertionId.startsWith("tenant_123:")).toBe(true);
    }
  });
});
