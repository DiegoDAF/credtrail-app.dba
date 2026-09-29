import { chunkValues, uniqueNonEmptyStrings } from "./assertion-internal.js";
import type { SqlDatabase } from "./tenant-scope.js";
import type { AssertionLifecycleState } from "./assertion-types.js";
import {
  effectiveAssertionLifecycleStateSql,
  latestAssertionLifecycleJoinSql,
} from "./assertion-lifecycle-sql.js";

/** Current institutional award, preferring a still-valid award over historical records. */
export interface BadgeAwardCycle {
  readonly assertionId: string;
  readonly issuedAt: string;
  readonly state: AssertionLifecycleState;
}

/** Reads current cycles in bounded batches for automated roster evaluation. */
export const listBadgeAwardCycles = async (
  db: SqlDatabase,
  input: {
    readonly tenantId: string;
    readonly badgeTemplateId: string;
    readonly recipientEmails: readonly string[];
  },
): Promise<readonly (BadgeAwardCycle & { readonly recipientEmail: string })[]> => {
  const emails = uniqueNonEmptyStrings(
    input.recipientEmails.map((email) => email.trim().toLowerCase()),
  );
  const cycles: (BadgeAwardCycle & { readonly recipientEmail: string })[] = [];
  for (const batch of chunkValues(emails, 400)) {
    const result = await db
      .prepare(`
      SELECT DISTINCT ON (LOWER(TRIM(assertions.recipient_identity)))
        LOWER(TRIM(assertions.recipient_identity)) AS recipientEmail,
        assertions.id AS assertionId, assertions.issued_at AS issuedAt,
        ${effectiveAssertionLifecycleStateSql} AS state
      FROM assertions ${latestAssertionLifecycleJoinSql}
      WHERE assertions.tenant_id = ? AND assertions.badge_template_id = ?
        AND assertions.recipient_identity_type = 'email'
        AND LOWER(TRIM(assertions.recipient_identity)) IN (${batch.map(() => "?").join(", ")})
      ORDER BY LOWER(TRIM(assertions.recipient_identity)),
        ((${effectiveAssertionLifecycleStateSql}) = 'active') DESC,
        assertions.issued_at DESC, assertions.id DESC
    `)
      .bind(input.tenantId, input.badgeTemplateId, ...batch)
      .all<BadgeAwardCycle & { recipientEmail: string }>();
    cycles.push(...result.results);
  }
  return cycles;
};

/** Reads the learner's current award across courses and rule versions. */
export const findBadgeAwardCycle = async (
  db: SqlDatabase,
  input: {
    readonly tenantId: string;
    readonly badgeTemplateId: string;
    readonly recipientEmail: string;
  },
): Promise<BadgeAwardCycle | null> =>
  (
    await listBadgeAwardCycles(db, {
      tenantId: input.tenantId,
      badgeTemplateId: input.badgeTemplateId,
      recipientEmails: [input.recipientEmail],
    })
  )[0] ?? null;

/** Serializes renewals across rules and courses before checking the previous award. */
export const lockBadgeAwardCycle = async (
  db: SqlDatabase,
  input: {
    readonly tenantId: string;
    readonly badgeTemplateId: string;
    readonly recipientEmail: string;
  },
): Promise<void> => {
  await db
    .prepare("SELECT pg_advisory_xact_lock(hashtext(?))")
    .bind(
      JSON.stringify([
        "badge-award",
        input.tenantId,
        input.badgeTemplateId,
        input.recipientEmail.trim().toLowerCase(),
      ]),
    )
    .run();
  await db
    .prepare(`SELECT id FROM assertions WHERE tenant_id = ? AND badge_template_id = ?
    AND recipient_identity_type = 'email' AND LOWER(TRIM(recipient_identity)) = ? FOR UPDATE`)
    .bind(input.tenantId, input.badgeTemplateId, input.recipientEmail.trim().toLowerCase())
    .all<{ id: string }>();
};
