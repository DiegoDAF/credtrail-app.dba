CREATE TABLE IF NOT EXISTS oid4vci_pre_authorized_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assertion_id TEXT NOT NULL,
  public_badge_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_oid4vci_pre_authorized_codes_lookup
  ON oid4vci_pre_authorized_codes (code_hash, expires_at);

CREATE TABLE IF NOT EXISTS oid4vci_access_tokens (
  id TEXT PRIMARY KEY,
  access_token_hash TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assertion_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_oid4vci_access_tokens_lookup
  ON oid4vci_access_tokens (access_token_hash, expires_at);
