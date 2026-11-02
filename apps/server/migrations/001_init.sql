-- OpenAnnounce: news, announcements and maintenance messages for a company's systems.
--
--   tenants                      a company (or a division) with its own systems, groups and messages
--     ├─ memberships             who manages it: admins and developers (accounts can be in several)
--     ├─ systems                 an app the messages show in, with a public key and a signing secret
--     ├─ groups / end_users      who sees what; end users are the host systems' users, by their id there
--     └─ messages                news, announcements and maintenance, aimed at systems and groups
--
-- Every tenant table has row-level security: a request only sees the tenant it was opened for
-- (openannounce.tenant_id), so a query that forgets its WHERE clause can't leak another tenant.

CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE CHECK (email = lower(email)),
  name            text NOT NULL DEFAULT '',
  password_hash   text NOT NULL,
  is_server_admin boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_account ON sessions(account_id);

CREATE TYPE member_role AS ENUM ('admin', 'developer');

CREATE TABLE memberships (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role       member_role NOT NULL,
  PRIMARY KEY (tenant_id, account_id)
);
CREATE INDEX memberships_account ON memberships(account_id);

CREATE TABLE systems (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug            text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name            text NOT NULL,
  public_key      text NOT NULL UNIQUE,
  signing_secret  text NOT NULL,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE groups (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug      text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name      text NOT NULL,
  UNIQUE (tenant_id, slug)
);

CREATE TABLE end_users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  name        text NOT NULL DEFAULT '',
  UNIQUE (tenant_id, external_id)
);

CREATE TABLE user_groups (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES end_users(id) ON DELETE CASCADE,
  group_id  uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);
CREATE INDEX user_groups_group ON user_groups(group_id);

CREATE TYPE message_kind AS ENUM ('news', 'announcement', 'maintenance');
CREATE TYPE message_display AS ENUM ('banner', 'popup', 'popover', 'sidebar');
CREATE TYPE message_severity AS ENUM ('info', 'warning', 'critical');
CREATE TYPE message_status AS ENUM ('draft', 'published', 'archived');

CREATE TABLE messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind       message_kind NOT NULL,
  display    message_display NOT NULL,
  severity   message_severity NOT NULL DEFAULT 'info',
  title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body       text NOT NULL DEFAULT '' CHECK (length(body) <= 10000),
  closeable  boolean NOT NULL,
  link_url   text CHECK (link_url ~ '^https?://'),
  link_label text,
  status     message_status NOT NULL DEFAULT 'draft',
  starts_at  timestamptz,
  ends_at    timestamptz CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- The same rules as resolveDisplay in @openstuff-dev/announce, so no client can store others.
  CONSTRAINT display_fits_kind CHECK (
    (kind = 'announcement' AND display IN ('banner', 'popup') AND closeable)
    OR (kind = 'maintenance' AND display = 'banner' AND NOT closeable)
    OR (kind = 'maintenance' AND display = 'popover')
    OR (kind = 'news' AND display = 'sidebar')
  )
);
CREATE INDEX messages_live ON messages(tenant_id, status, kind);

CREATE TABLE message_systems (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  system_id  uuid NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, system_id)
);

CREATE TABLE message_groups (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, group_id)
);

-- Row-level security ------------------------------------------------------------------------

CREATE FUNCTION openannounce_tenant() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('openannounce.tenant_id', true), '')::uuid $$;
CREATE FUNCTION openannounce_bypass() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('openannounce.bypass', true), '') = 'on' $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['systems', 'groups', 'end_users', 'user_groups', 'messages',
                           'message_systems', 'message_groups'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
      USING (openannounce_bypass() OR tenant_id = openannounce_tenant())
      WITH CHECK (openannounce_bypass() OR tenant_id = openannounce_tenant())', t);
  END LOOP;
END $$;

-- The role every request runs as. Superusers skip row-level security, so the server switches
-- to this role on each connection (see createPool in src/db.ts).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openannounce_app') THEN
    CREATE ROLE openannounce_app NOLOGIN;
  END IF;
END $$;
