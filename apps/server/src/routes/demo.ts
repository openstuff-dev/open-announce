import type { FastifyInstance } from 'fastify';
import { signUser } from '@openstuff-dev/announce/server';
import type { Config } from '../config.js';
import { type Pool, withScope } from '../db.js';
import { DEMO_SYSTEM, DEMO_TENANT } from '../seed-demo.js';

const people = {
  visitor: { label: 'Nobody signed in', claims: null },
  alice: { label: 'Alice (staff)', claims: { sub: 'alice' } },
  bob: { label: 'Bob (staff, finance)', claims: { sub: 'bob' } },
} as const;

/**
 * /demo: a pretend host system that embeds all three elements, for trying OpenAnnounce out.
 * The server plays the host's backend too: it signs the chosen user with the system's secret,
 * the way your backend would with `signUser`.
 */
export function registerDemo(
  app: FastifyInstance,
  pool: Pool,
  config: Config,
): void {
  app.get('/demo', async (request, reply) => {
    const as = (request.query as { as?: string }).as;
    const person =
      as && Object.hasOwn(people, as) ? people[as as keyof typeof people] : people.visitor;
    const system = await withScope(pool, { bypass: true }, async (db) => {
      const { rows } = await db.query<{ publicKey: string; secret: string }>(
        `SELECT s.public_key AS "publicKey", s.signing_secret AS secret
           FROM systems s JOIN tenants t ON t.id = s.tenant_id WHERE t.slug = $1 AND s.slug = $2`,
        [DEMO_TENANT, DEMO_SYSTEM],
      );
      return rows.at(0);
    });
    if (!system) {
      return reply.code(404).type('text/plain').send('Run `npm run seed:demo -w apps/server` first.');
    }
    const token = person.claims ? await signUser(system.secret, person.claims) : null;
    return reply.type('text/html; charset=utf-8').send(page(config.publicUrl, system.publicKey, token, as));
  });
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(
  url: string,
  publicKey: string,
  token: string | null,
  as: string | undefined,
): string {
  const config = JSON.stringify({ url, publicKey, user: token, cacheTtl: 5, refreshInterval: 15 });
  const options = Object.entries(people)
    .map(([value, p]) => `<option value="${value}"${value === (as ?? 'visitor') ? ' selected' : ''}>${esc(p.label)}</option>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Acme Portal · OpenAnnounce demo</title>
  <script type="importmap">{ "imports": { "@openstuff-dev/announce/": "/sdk/" } }</script>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; background: light-dark(#f6f6f7, #111113); color: light-dark(#1c1c1f, #ededef); }
    header { display: flex; gap: 12px; align-items: center; padding: 12px 20px; flex-wrap: wrap;
      background: light-dark(#fff, #1c1c1f); border-bottom: 1px solid light-dark(#e4e4e7, #34343a); }
    header strong { margin-inline-end: auto; }
    button, select { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid light-dark(#d4d4d8, #3f3f46);
      background: light-dark(#fff, #27272a); color: inherit; cursor: pointer; }
    .badge { display: inline-block; min-width: 1.4em; padding: 0 6px; margin-inline-start: 6px; border-radius: 999px;
      background: #e8590c; color: #fff; font-size: 0.8em; text-align: center; }
    .badge[hidden] { display: none; }
    main { max-width: 760px; margin: 32px auto; padding: 0 20px; line-height: 1.6; }
    code { font-size: 0.9em; }
  </style>
</head>
<body>
  <oa-maintenance></oa-maintenance>
  <oa-announcements></oa-announcements>
  <header>
    <strong>Acme Portal</strong>
    <label>Signed in as
      <select id="as" onchange="location.search = this.value === 'visitor' ? '' : '?as=' + this.value">${options}</select>
    </label>
    <button type="button" class="news-button">What’s new<span class="badge" id="badge" hidden></span></button>
  </header>
  <main>
    <h1>A pretend host system</h1>
    <p>This page embeds <code>&lt;oa-maintenance&gt;</code> and <code>&lt;oa-announcements&gt;</code> at the top
      and <code>&lt;oa-news trigger=".news-button"&gt;</code>. Switch users to see group targeting:
      Alice gets the staff popup, Bob also gets the finance popover, which he can’t close.</p>
    <p>Close a banner and reload: it stays closed until an admin edits it. The feed is cached for 5 seconds
      here and checked every 15; edit a message in the admin app and watch it change.</p>
  </main>
  <oa-news trigger=".news-button"></oa-news>
  <script type="module">
    import { configure } from '@openstuff-dev/announce/core/index.js';
    import '@openstuff-dev/announce/announcements/index.js';
    import '@openstuff-dev/announce/maintenance/index.js';
    import '@openstuff-dev/announce/news/index.js';
    configure(${config.replace(/</g, '\\u003c')});
    const badge = document.getElementById('badge');
    document.querySelector('oa-news').addEventListener('openannounce:unread', (e) => {
      badge.textContent = e.detail.count;
      badge.hidden = e.detail.count === 0;
    });
  </script>
</body>
</html>`;
}
