import { findBadgeAwardCycle, lockBadgeAwardCycle } from "./badge-award-cycle.js";
import { parseBadgeIssuanceRuleDefinitionJson } from "@credtrail/validation";
import { createAuditLog, type CreateAuditLogInput } from "./audit-logs.js";
import type { BadgeAchievementSnapshot, IssuanceAchievementSource } from "@credtrail/validation";
import { createAssertionIssuanceProvenance } from "./assertion-issuance-provenance.js";
import type { AssertionIssuanceProvenanceRecord } from "./assertion-issuance-provenance.js";
import { badgeAchievementSnapshotFromRuleVersion } from "./badge-issuance-rule-achievement-snapshot.js";
import { findBadgeIssuanceRuleVersionById } from "./badge-issuance-rule-version-reads.js";
import { createAssertion } from "./assertion-writes.js";
import type { AssertionRecord, CreateAssertionInput } from "./assertion-types.js";
import { ensureLearnerLmsIdentity } from "./learner-lms-identities.js";
import { enqueueLearnerEvidenceChange } from "./learner-evidence-change-jobs.js";
import {
  lockEligibleLearnerPathwayCompletionHandoff,
  recordLearnerPathwayFinalCredentialIssuance,
} from "./learner-pathways.js";
import { runSqlTransaction, type SqlDatabase } from "./tenant-scope.js";

export interface FinalizeAssertionIssuanceInput {
  readonly assertion: Omit<CreateAssertionInput, "achievementSnapshot">;
  readonly achievementSource: IssuanceAchievementSource;
  readonly buildAuditLog: (assertion: AssertionRecord) => CreateAuditLogInput;
  readonly lmsLearnerIdentity?: {
    readonly connectionId: string;
    readonly learnerId: string;
  };
  readonly learnerPathwayCompletionHandoffId?: string | undefined;
}

/** Atomic assertion-finalization outcome, including an expected LMS identity conflict. */
export type FinalizeAssertionIssuanceResult =
  | {
      readonly status: "issued";
      readonly assertion: AssertionRecord;
      readonly provenance: AssertionIssuanceProvenanceRecord;
    }
  | {
      readonly status: "lms_identity_conflict";
      readonly reason: "lms_learner_id_in_use" | "learner_profile_in_use";
    }
  | {
      readonly status: "learner_pathway_handoff_conflict";
    }
  | { readonly status: "badge_renewal_conflict" };

export const finalizeAssertionIssuance = async (
  db: SqlDatabase,
  input: FinalizeAssertionIssuanceInput,
): Promise<FinalizeAssertionIssuanceResult> => {
  return runSqlTransaction(db, async (transactionDb) => {
    const achievementSource = input.achievementSource;
    let achievementSnapshot: BadgeAchievementSnapshot;

    if (achievementSource.kind === "template_snapshot") {
      achievementSnapshot = achievementSource.snapshot;
    } else {
      const ruleVersion = await findBadgeIssuanceRuleVersionById(transactionDb, {
        tenantId: input.assertion.tenantId,
        ruleId: achievementSource.provenance.ruleId,
        versionId: achievementSource.provenance.versionId,
      });

      if (ruleVersion === null) {
        throw new Error(
          `Governed badge rule version "${achievementSource.provenance.versionId}" was not found`,
        );
      }

      achievementSnapshot = badgeAchievementSnapshotFromRuleVersion(ruleVersion.snapshot);
      if (
        parseBadgeIssuanceRuleDefinitionJson(ruleVersion.ruleJson).options?.renewal !== undefined
      ) {
        if (
          input.assertion.validUntil === undefined ||
          input.assertion.recipientIdentityType !== "email"
        ) {
          return { status: "badge_renewal_conflict" };
        }
        const cycleInput = {
          tenantId: input.assertion.tenantId,
          badgeTemplateId: achievementSnapshot.badgeTemplateId,
          recipientEmail: input.assertion.recipientIdentity,
        };
        await lockBadgeAwardCycle(transactionDb, cycleInput);
        const currentCycle = await findBadgeAwardCycle(transactionDb, cycleInput);
        const previousId = input.assertion.renewalOfAssertionId ?? null;
        if (
          currentCycle === null
            ? previousId !== null
            : currentCycle.state !== "expired" || previousId !== currentCycle.assertionId
        ) {
          return { status: "badge_renewal_conflict" };
        }
      }
    }

    if (input.learnerPathwayCompletionHandoffId !== undefined) {
      if (input.assertion.learnerProfileId === undefined) {
        return { status: "learner_pathway_handoff_conflict" };
      }

      const handoffEligible = await lockEligibleLearnerPathwayCompletionHandoff(transactionDb, {
        tenantId: input.assertion.tenantId,
        handoffId: input.learnerPathwayCompletionHandoffId,
        learnerProfileId: input.assertion.learnerProfileId,
        badgeTemplateId: achievementSnapshot.badgeTemplateId,
      });

      if (!handoffEligible) {
        return { status: "learner_pathway_handoff_conflict" };
      }
    }

    if (input.lmsLearnerIdentity !== undefined) {
      if (input.assertion.learnerProfileId === undefined) {
        throw new Error("LMS learner identity requires an assertion learner profile");
      }

      const linkResult = await ensureLearnerLmsIdentity(transactionDb, {
        tenantId: input.assertion.tenantId,
        connectionId: input.lmsLearnerIdentity.connectionId,
        lmsLearnerId: input.lmsLearnerIdentity.learnerId,
        learnerProfileId: input.assertion.learnerProfileId,
        linkedAt: input.assertion.issuedAt,
      });

      if (linkResult.status === "conflict") {
        return { status: "lms_identity_conflict", reason: linkResult.reason };
      }
    }

    const assertion = await createAssertion(transactionDb, {
      ...input.assertion,
      achievementSnapshot,
    });

    if (input.learnerPathwayCompletionHandoffId !== undefined) {
      if (assertion.learnerProfileId === null) {
        throw new Error("Locked pathway handoff assertion is missing its learner profile");
      }

      const recorded = await recordLearnerPathwayFinalCredentialIssuance(transactionDb, {
        tenantId: assertion.tenantId,
        handoffId: input.learnerPathwayCompletionHandoffId,
        learnerProfileId: assertion.learnerProfileId,
        badgeTemplateId: assertion.badgeTemplateId,
        assertionId: assertion.id,
        issuedAt: assertion.issuedAt,
        ...(assertion.issuedByUserId === null ? {} : { actorUserId: assertion.issuedByUserId }),
      });

      if (!recorded) {
        throw new Error("Locked pathway completion handoff changed during issuance");
      }
    }

    if (assertion.learnerProfileId !== null) {
      await enqueueLearnerEvidenceChange(transactionDb, {
        tenantId: assertion.tenantId,
        learnerProfileId: assertion.learnerProfileId,
        trigger: "assertion_issued",
        evidenceEventId: assertion.id,
        requestedAt: assertion.issuedAt,
      });
    }

    if (assertion.learnerProfileId !== null && assertion.validUntil !== null) {
      await enqueueLearnerEvidenceChange(transactionDb, {
        tenantId: assertion.tenantId,
        learnerProfileId: assertion.learnerProfileId,
        trigger: "assertion_status_changed",
        evidenceEventId: `expiry:${assertion.id}`,
        requestedAt: assertion.issuedAt,
        availableAt: assertion.validUntil,
      });
    }

    await createAuditLog(transactionDb, input.buildAuditLog(assertion));
    const provenance = await createAssertionIssuanceProvenance(transactionDb, {
      ...achievementSource.provenance,
      assertionId: assertion.id,
      tenantId: assertion.tenantId,
    });

    return { status: "issued", assertion, provenance };
  });
};
