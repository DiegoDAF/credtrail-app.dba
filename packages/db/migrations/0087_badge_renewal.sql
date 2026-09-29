ALTER TABLE assertions ADD COLUMN valid_until TEXT;
ALTER TABLE assertions ADD COLUMN renewal_of_assertion_id TEXT;
ALTER TABLE assertions ADD CONSTRAINT assertions_renewal_predecessor_fk
  FOREIGN KEY (tenant_id, renewal_of_assertion_id) REFERENCES assertions(tenant_id, id);
ALTER TABLE assertions ADD CONSTRAINT assertions_validity_period_check
  CHECK (valid_until IS NULL OR valid_until::timestamptz > issued_at::timestamptz);
CREATE UNIQUE INDEX assertions_one_renewal_per_award
  ON assertions (tenant_id, renewal_of_assertion_id)
  WHERE renewal_of_assertion_id IS NOT NULL;
CREATE INDEX assertions_validity_due ON assertions (tenant_id, valid_until)
  WHERE valid_until IS NOT NULL AND revoked_at IS NULL;
