import { z } from "zod";
import type { SqlDatabase } from "./tenant-scope.js";

const pendingAwardSchema = z.object({
  learnerProfileId: z.string().min(1),
  badgeTemplateId: z.string().min(1),
});

/** Resolves only an unissued automatic handoff belonging to this tenant and enrollment. */
export const findPendingAutomaticLearnerPathwayAward = async (
  db: SqlDatabase,
  input: { readonly tenantId: string; readonly enrollmentId: string; readonly handoffId: string },
): Promise<z.infer<typeof pendingAwardSchema> | null> => {
  const row = await db
    .prepare(`
    SELECT enrollments.learner_profile_id AS learnerProfileId,
      handoffs.badge_template_id AS badgeTemplateId
    FROM learner_pathway_completion_handoffs handoffs
    INNER JOIN learner_pathway_enrollments enrollments
      ON enrollments.tenant_id = handoffs.tenant_id AND enrollments.id = handoffs.enrollment_id
    WHERE handoffs.tenant_id = ? AND handoffs.id = ? AND handoffs.enrollment_id = ?
      AND handoffs.behavior = 'issue_credential' AND handoffs.status = 'eligible'
      AND enrollments.status <> 'withdrawn'
    LIMIT 1
  `)
    .bind(input.tenantId, input.handoffId, input.enrollmentId)
    .first<unknown>();
  return row === null ? null : pendingAwardSchema.parse(row);
};
