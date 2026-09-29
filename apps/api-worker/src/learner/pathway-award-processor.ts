import {
  evaluateLearnerPathwayEnrollment,
  findBadgeTemplateById,
  findPendingAutomaticLearnerPathwayAward,
  listLearnerIdentitiesByProfile,
  type SqlDatabase,
} from "@credtrail/db";
import { recipientIdentityTypeSchema } from "@credtrail/validation";
import { badgeAchievementSnapshotFromTemplate } from "../badges/badge-achievement-snapshot";
import type { DirectIssueBadgeRequest } from "../badges/recipient-identifiers";

/** Outcome of delivering an automatic pathway award through the normal issuance service. */
export type PathwayAwardResult =
  | { readonly status: "issued" | "skipped" }
  | { readonly status: "blocked"; readonly reason: "badge_unavailable" | "recipient_unavailable" };

/** Rechecks current evidence and awards once, with finalization bound to the exact handoff. */
export const processLearnerPathwayAward = async (input: {
  readonly db: SqlDatabase;
  readonly tenantId: string;
  readonly enrollmentId: string;
  readonly handoffId: string;
  readonly issueBadge: (request: DirectIssueBadgeRequest) => Promise<unknown>;
}): Promise<PathwayAwardResult> => {
  const pending = await findPendingAutomaticLearnerPathwayAward(input.db, input);
  if (pending === null) return { status: "skipped" };

  const evaluation = await evaluateLearnerPathwayEnrollment(input.db, {
    tenantId: input.tenantId,
    enrollmentId: input.enrollmentId,
    trigger: "automatic_issuance",
  });
  if (evaluation.result !== "complete") return { status: "skipped" };

  const template = await findBadgeTemplateById(input.db, input.tenantId, pending.badgeTemplateId);
  if (template === null || template.isArchived)
    return { status: "blocked", reason: "badge_unavailable" };

  const identities = await listLearnerIdentitiesByProfile(
    input.db,
    input.tenantId,
    pending.learnerProfileId,
  );
  for (const identity of identities) {
    const type = recipientIdentityTypeSchema.safeParse(identity.identityType);
    if (!type.success) continue;
    await input.issueBadge({
      achievementSource: {
        kind: "template_snapshot",
        snapshot: badgeAchievementSnapshotFromTemplate(template),
        provenance: { source: "programmatic" },
      },
      recipientIdentity: identity.identityValue,
      recipientIdentityType: type.data,
      learnerPathwayCompletionHandoffId: input.handoffId,
      idempotencyKey: `pathway-award:${input.handoffId}`,
    });
    return { status: "issued" };
  }
  return { status: "blocked", reason: "recipient_unavailable" };
};
