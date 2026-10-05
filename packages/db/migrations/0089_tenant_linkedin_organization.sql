ALTER TABLE tenants
  ADD COLUMN linkedin_organization_id TEXT DEFAULT NULL
  CONSTRAINT tenants_linkedin_organization_id_check
  CHECK (linkedin_organization_id IS NULL OR linkedin_organization_id ~ '^[1-9][0-9]{0,19}$');
