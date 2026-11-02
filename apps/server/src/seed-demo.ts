import { fileURLToPath } from 'node:url';
import { hashPassword } from './auth.js';
import { loadConfig } from './config.js';
import { createPool, migrate, type Pool, withScope } from './db.js';
import { newPublicKey, newSigningSecret } from './routes/shared.js';

export const DEMO_TENANT = 'demo';
export const DEMO_SYSTEM = 'demo-app';
export const DEMO_DEVELOPER = { email: 'developer@example.com', password: 'demo-developer' };

/**
 * (Re)creates the demo tenant: one system, two groups, two users and a message for every
 * display. Runs as a script (`npm run seed:demo -w apps/server`) and from the tests.
 */
export async function seedDemo(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM tenants WHERE slug = $1', [DEMO_TENANT]);
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO tenants (slug, name) VALUES ($1, 'Demo company') RETURNING id",
    [DEMO_TENANT],
  );
  const tenantId = rows[0].id;
  const dev = await pool.query<{ id: string }>(
    `INSERT INTO accounts (email, name, password_hash) VALUES ($1, 'Demo developer', $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`,
    [DEMO_DEVELOPER.email, await hashPassword(DEMO_DEVELOPER.password)],
  );
  await pool.query("INSERT INTO memberships VALUES ($1, $2, 'developer')", [tenantId, dev.rows[0].id]);

  await withScope(pool, { tenantId }, async (db) => {
    const t = db.escapeLiteral(tenantId);
    const day = (n: number) => `now() + interval '${n} days'`;
    await db.query(`
      INSERT INTO systems (tenant_id, slug, name, public_key, signing_secret)
        VALUES (${t}, '${DEMO_SYSTEM}', 'Demo app', ${db.escapeLiteral(newPublicKey())}, ${db.escapeLiteral(newSigningSecret())});
      INSERT INTO groups (tenant_id, slug, name) VALUES (${t}, 'staff', 'Staff'), (${t}, 'finance', 'Finance');
      INSERT INTO end_users (tenant_id, external_id, name) VALUES (${t}, 'alice', 'Alice'), (${t}, 'bob', 'Bob');
      INSERT INTO user_groups (tenant_id, user_id, group_id)
        SELECT ${t}, u.id, g.id FROM end_users u, groups g
         WHERE (u.external_id, g.slug) IN (('alice', 'staff'), ('bob', 'staff'), ('bob', 'finance'));

      WITH m AS (INSERT INTO messages (tenant_id, kind, display, severity, title, body, closeable, status,
                   link_url, link_label, starts_at, ends_at) VALUES
        (${t}, 'announcement', 'banner', 'info', 'The new reporting page is live',
         'Find it under Reports. Your old bookmarks still work.', true, 'published',
         'https://example.com/reports', 'See what changed', NULL, NULL),
        (${t}, 'maintenance', 'banner', 'warning', 'Planned maintenance on Saturday, 06:00–08:00 UTC',
         'You can read everything, but saving is paused for those two hours.', false, 'published',
         NULL, NULL, NULL, ${day(5)}),
        (${t}, 'news', 'sidebar', 'info', 'Dark mode is here',
         'The app now follows your system''s light or dark setting.' || chr(10) || chr(10) || 'Change it any time under Settings › Appearance.',
         true, 'published', NULL, NULL, now() - interval '1 day', NULL),
        (${t}, 'news', 'sidebar', 'info', 'Faster search',
         'Search results now show up as you type.', true, 'published', NULL, NULL, now() - interval '8 days', NULL),
        (${t}, 'announcement', 'banner', 'info', 'This one is a draft', 'Nobody sees drafts.', true, 'draft',
         NULL, NULL, NULL, NULL)
        RETURNING id) SELECT count(*) FROM m;

      -- For staff only (Alice and Bob): a popup.
      WITH m AS (INSERT INTO messages (tenant_id, kind, display, severity, title, body, closeable, status)
        VALUES (${t}, 'announcement', 'popup', 'info', 'Welcome to the new staff portal',
          'We moved the timesheets to the left menu. Everything else is where it was.', true, 'published')
        RETURNING id)
      INSERT INTO message_groups SELECT ${t}, m.id, g.id FROM m, groups g WHERE g.slug = 'staff';

      -- For finance only (Bob): a popover nobody can close.
      WITH m AS (INSERT INTO messages (tenant_id, kind, display, severity, title, body, closeable, status, ends_at)
        VALUES (${t}, 'maintenance', 'popover', 'critical', 'Invoicing is down',
          'We''re on it. Invoices you send now are queued and go out when it''s back.', false, 'published', ${day(1)})
        RETURNING id)
      INSERT INTO message_groups SELECT ${t}, m.id, g.id FROM m, groups g WHERE g.slug = 'finance';
    `);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = loadConfig();
  await migrate(config.databaseUrl, fileURLToPath(new URL('../migrations', import.meta.url)));
  const pool = createPool(config.databaseUrl);
  await seedDemo(pool);
  await pool.end();
  console.log(
    `Seeded the "${DEMO_TENANT}" tenant. Developer sign-in: ${DEMO_DEVELOPER.email} / ${DEMO_DEVELOPER.password}.\n` +
    'Set OPENANNOUNCE_DEMO=on and open /demo to see it in a host page.',
  );
}
