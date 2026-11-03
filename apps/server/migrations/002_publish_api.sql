-- The publish API: another system (OpenVersion, a CI job) posts News to one system with a
-- publish key (ak_…). Only the key's SHA-256 and its last four characters are kept.

ALTER TABLE systems
  ADD COLUMN publish_key_hash text UNIQUE,
  ADD COLUMN publish_key_last4 text;

-- One row per Idempotency-Key a system has used, written in the same transaction as the
-- message, so a retried request returns the first message instead of posting twice.
CREATE TABLE publish_requests (
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  system_id       uuid NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash    text NOT NULL,
  message_id      uuid REFERENCES messages(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (system_id, idempotency_key)
);

ALTER TABLE publish_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE publish_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON publish_requests
  USING (openannounce_bypass() OR tenant_id = openannounce_tenant())
  WITH CHECK (openannounce_bypass() OR tenant_id = openannounce_tenant());
