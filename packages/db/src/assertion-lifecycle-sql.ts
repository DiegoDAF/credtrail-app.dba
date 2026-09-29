/** Effective credential status, evaluated at read time so expiry never waits for a job. */
export const effectiveAssertionLifecycleStateSql = `CASE
  WHEN assertions.revoked_at IS NOT NULL THEN 'revoked'
  WHEN lifecycle.to_state IN ('revoked', 'suspended') THEN lifecycle.to_state
  WHEN assertions.valid_until::timestamptz <= statement_timestamp() THEN 'expired'
  ELSE COALESCE(lifecycle.to_state, 'active') END`;

/** Latest event scoped to the assertion and institution. Requires the assertions table alias. */
export const latestAssertionLifecycleJoinSql = `LEFT JOIN assertion_lifecycle_events lifecycle
  ON lifecycle.id = (
    SELECT ale.id FROM assertion_lifecycle_events ale
    WHERE ale.tenant_id = assertions.tenant_id AND ale.assertion_id = assertions.id
    ORDER BY ale.transitioned_at DESC, ale.created_at DESC, ale.id DESC LIMIT 1
  )`;
