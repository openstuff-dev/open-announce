-- The OpenVersion deploy token, encrypted with the vault. It lets this server publish its own version
-- on start. Never returned by the API and never in an export.
ALTER TABLE server_integrations ADD COLUMN deploy_token_sealed text;

-- Holds the generated secret key when OPENANNOUNCE_SECRET_KEY isn't set (see loadVault).
CREATE TABLE server_settings (
  name  text PRIMARY KEY,
  value text NOT NULL
);
