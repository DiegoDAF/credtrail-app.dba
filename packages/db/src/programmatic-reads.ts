import { z } from "zod";
import {
  programmaticOperationIdentitySchema,
  programmaticAssertionSchema,
  programmaticTemplateSchema,
  type ProgrammaticAssertionQuery,
  type ProgrammaticTemplateQuery,
} from "@credtrail/validation";
import {
  effectiveAssertionLifecycleStateSql,
  latestAssertionLifecycleJoinSql,
} from "./assertion-lifecycle-sql.js";
import type { SqlDatabase } from "./tenant-scope.js";

const templateRowSchema = programmaticTemplateSchema.extend({ imageUrl: z.string().nullable() });
/** Storage projection used for programmatic template reads. */
export type ProgrammaticTemplateRecord = z.infer<typeof templateRowSchema>;
const assertionRowSchema = programmaticAssertionSchema
  .omit({ badgeUrl: true, credentialUrl: true })
  .extend({ publicId: z.string().nullable() });
/** Storage projection without credential blobs, keys, or administrative metadata. */
export type ProgrammaticAssertionRecord = z.infer<typeof assertionRowSchema>;
const templateSelect = `id AS badgeTemplateId, title, description,
  criteria_uri AS criteriaUrl, image_uri AS imageUrl, (is_archived = 1) AS archived`;
const assertionSelect = `assertions.id AS assertionId, assertions.public_id AS publicId,
  assertions.badge_template_id AS badgeTemplateId, assertions.recipient_identity AS recipientIdentity,
  assertions.recipient_identity_type AS recipientIdentityType, assertions.issued_at AS issuedAt,
  assertions.valid_until AS validUntil, ${effectiveAssertionLifecycleStateSql} AS state`;

/** A tenant-scoped page sorted by immutable ID, including one lookahead row. */
export const listProgrammaticTemplates = async (
  db: SqlDatabase,
  input: ProgrammaticTemplateQuery,
): Promise<ProgrammaticTemplateRecord[]> => {
  const conditions = ["tenant_id = ?"];
  const params: unknown[] = [input.tenantId];
  if (!input.includeArchived) conditions.push("is_archived = 0");
  if (input.cursor !== undefined) {
    conditions.push("id > ?");
    params.push(input.cursor);
  }
  const rows = await db
    .prepare(`SELECT ${templateSelect} FROM badge_templates
    WHERE ${conditions.join(" AND ")} ORDER BY id ASC LIMIT ?`)
    .bind(...params, input.limit + 1)
    .all<unknown>();
  return rows.results.map((row) => templateRowSchema.parse(row));
};
/** Individual lookup remains tenant-scoped even when a foreign ID is supplied. */
export const findProgrammaticTemplate = async (
  db: SqlDatabase,
  tenantId: string,
  badgeTemplateId: string,
): Promise<ProgrammaticTemplateRecord | null> => {
  const row = await db
    .prepare(`SELECT ${templateSelect} FROM badge_templates WHERE tenant_id = ? AND id = ?`)
    .bind(tenantId, badgeTemplateId)
    .first<unknown>();
  return row === null ? null : templateRowSchema.parse(row);
};
/** Bounded reconciliation using exact identities, inclusive UTC dates, and immutable-ID pagination. */
export const listProgrammaticAssertions = async (
  db: SqlDatabase,
  input: ProgrammaticAssertionQuery,
): Promise<ProgrammaticAssertionRecord[]> => {
  const conditions = ["assertions.tenant_id = ?"];
  const params: unknown[] = [input.tenantId];
  if (input.cursor !== undefined) {
    conditions.push("assertions.id > ?");
    params.push(input.cursor);
  }
  if (input.badgeTemplateId !== undefined) {
    conditions.push("assertions.badge_template_id = ?");
    params.push(input.badgeTemplateId);
  }
  if (input.recipientIdentity !== undefined) {
    conditions.push(
      "CASE WHEN assertions.recipient_identity_type = 'email' THEN LOWER(assertions.recipient_identity) = LOWER(?) ELSE assertions.recipient_identity = ? END",
    );
    params.push(input.recipientIdentity, input.recipientIdentity);
  }
  if (input.recipientIdentityType !== undefined) {
    conditions.push("assertions.recipient_identity_type = ?");
    params.push(input.recipientIdentityType);
  }
  if (input.issuedFrom !== undefined) {
    conditions.push("assertions.issued_at::timestamptz >= ?::date AT TIME ZONE 'UTC'");
    params.push(input.issuedFrom);
  }
  if (input.issuedTo !== undefined) {
    conditions.push(
      "assertions.issued_at::timestamptz < (?::date + INTERVAL '1 day') AT TIME ZONE 'UTC'",
    );
    params.push(input.issuedTo);
  }
  const rows = await db
    .prepare(`SELECT ${assertionSelect} FROM assertions ${latestAssertionLifecycleJoinSql}
    WHERE ${conditions.join(" AND ")} ORDER BY assertions.id ASC LIMIT ?`)
    .bind(...params, input.limit + 1)
    .all<unknown>();
  return rows.results.map((row) => assertionRowSchema.parse(row));
};
/** Single assertion read with its effective lifecycle state, including immediate expiry. */
export const findProgrammaticAssertion = async (
  db: SqlDatabase,
  tenantId: string,
  assertionId: string,
): Promise<ProgrammaticAssertionRecord | null> => {
  const row = await db
    .prepare(`SELECT ${assertionSelect} FROM assertions ${latestAssertionLifecycleJoinSql}
    WHERE assertions.tenant_id = ? AND assertions.id = ?`)
    .bind(tenantId, assertionId)
    .first<unknown>();
  return row === null ? null : assertionRowSchema.parse(row);
};

const timestamp = z.iso.datetime({ offset: true });
const operationRowSchema = z.discriminatedUnion("status", [
  programmaticOperationIdentitySchema.extend({
    status: z.literal("pending"),
    nextAttemptAt: timestamp,
  }),
  programmaticOperationIdentitySchema.extend({ status: z.literal("processing") }),
  programmaticOperationIdentitySchema.extend({
    status: z.literal("completed"),
    completedAt: timestamp,
    publicId: z.string().nullable(),
  }),
  programmaticOperationIdentitySchema.extend({ status: z.literal("failed"), failedAt: timestamp }),
]);
/** Operation persistence projection deliberately omits raw errors and lease credentials. */
export type ProgrammaticOperationRecord = z.infer<typeof operationRowSchema>;
/** Only issuance and revocation operations can be read through the public integration API. */
export const findProgrammaticOperation = async (
  db: SqlDatabase,
  tenantId: string,
  operationId: string,
): Promise<ProgrammaticOperationRecord | null> => {
  const row = await db
    .prepare(`SELECT jobs.id AS operationId, jobs.tenant_id AS tenantId, jobs.job_type AS jobType,
    jobs.payload_json::jsonb ->> 'assertionId' AS assertionId,
    jobs.idempotency_key AS idempotencyKey, jobs.attempt_count AS attemptCount,
    jobs.status, jobs.available_at AS nextAttemptAt, jobs.completed_at AS completedAt,
    jobs.failed_at AS failedAt, jobs.created_at AS createdAt, jobs.updated_at AS updatedAt,
    assertions.public_id AS publicId FROM job_queue_messages AS jobs
    LEFT JOIN assertions ON jobs.status = 'completed' AND assertions.tenant_id = jobs.tenant_id
      AND assertions.id = jobs.payload_json::jsonb ->> 'assertionId'
    WHERE jobs.tenant_id = ? AND jobs.id = ? AND jobs.job_type IN ('issue_badge', 'revoke_badge')`)
    .bind(tenantId, operationId)
    .first<unknown>();
  return row === null ? null : operationRowSchema.parse(row);
};
