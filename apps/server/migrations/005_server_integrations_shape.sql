-- The same server_integrations shape as every OpenStuff app, so the shared @openstuff-dev/server
-- routes run here unchanged. The deploy token keeps its value; only the column's name changes.
ALTER TABLE server_integrations RENAME COLUMN deploy_token_sealed TO deploy_token_encrypted;
ALTER TABLE server_integrations ADD COLUMN signing_secret_encrypted text;
