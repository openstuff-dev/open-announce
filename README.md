# OpenAnnounce

News, announcements and maintenance messages for every system your company runs, shown to the
right people.

Admins write a message once, aim it at systems and user groups, and publish it. Each system shows
it with three web components from [`@openstuff-dev/announce`](packages/announce): a banner, a
popup, a corner popover or a news sidebar, depending on the message.

| Kind | Shows as | Can users close it? |
|---|---|---|
| Announcement | Banner or popup | Yes, until the message is edited |
| Maintenance | Banner | No |
| Maintenance | Popover | The admin decides per message |
| News | Sidebar, opened by a button you choose | It's a sidebar: they open and close it |

The hosted version runs at https://announce.openstuff.app; the project's page is
https://announce.openstuff.dev.

## Who does what

- **Server admins** add tenants: a company or a division, kept apart from the others with
  Postgres row-level security.
- **Admins** of a tenant add systems, groups, users and members, and write the messages.
- **Developers** add OpenAnnounce to a system: they copy its public key, set the origins that may
  read its feed, replace its secret, and sign users in their backend.
- **Users** see the messages for their groups in the systems they use.

## Try it

```sh
cp .env.example .env
docker compose up -d --build
docker compose logs app | grep "first admin"   # the admin's password, shown once
```

Open http://localhost:8080 and sign in. To see the elements in a pretend host system, seed the
demo tenant and turn the demo page on:

```sh
OPENANNOUNCE_DEMO=on docker compose up -d
docker compose exec app node dist/seed-demo.js
```

Then open http://localhost:8080/demo and switch between Alice (staff) and Bob (staff and finance).

## Add it to a system

In the admin app, open **Systems**, add the system, and copy its secret: it's shown once. The
system's setup tabs have the code below with your own URL and key filled in.

```sh
npm install @openstuff-dev/announce
```

```js
// openannounce.config.js
import { defineConfig } from '@openstuff-dev/announce';

export default defineConfig({
  url: 'https://announce.example.com',
  publicKey: 'pk_…',
  // A token your backend makes for the signed-in user. Leave it out to show only the
  // messages meant for everyone.
  user: () => fetch('/api/openannounce-token').then((r) => r.text()),
});
```

```html
<oa-maintenance></oa-maintenance>
<oa-announcements></oa-announcements>
<oa-news trigger=".news-button"></oa-news>

<script type="module">
  import { configure } from '@openstuff-dev/announce';
  import '@openstuff-dev/announce/announcements';
  import '@openstuff-dev/announce/maintenance';
  import '@openstuff-dev/announce/news';
  import config from './openannounce.config.js';
  configure(config);
</script>
```

```js
// Your backend, for the signed-in user
import { signUser } from '@openstuff-dev/announce/server';

const token = await signUser(process.env.OPENANNOUNCE_SECRET, {
  sub: user.id, // their id in your system
  groups: ['finance'], // group slugs; leave out to use the groups set in OpenAnnounce
});
```

No bundler? The server also serves the elements at `/sdk/`, for an import map. See
[the package's README](packages/announce/README.md) for styling, events and the full API.

### How fresh is a message?

The elements share one request per page. They reuse a fetched feed for `cacheTtl` seconds
(default 60, also across page loads), then ask again with `If-None-Match`, so an unchanged feed
costs a 304. An open page checks every `refreshInterval` seconds (default 300). What a user
closed is remembered in their browser until the message is edited.

## Post from another system

Other systems can post News to one system: a deploy tool posting release notes (like
[OpenVersion](https://github.com/openstuff-dev/open-version)), or a CI job. An admin makes the
system's **publish key** (`ak_…`) on the Systems page. It is shown once, stored only as a hash,
and can be replaced or revoked there. It is separate from the signing secret.

```sh
curl -X POST https://announce.example.com/api/v1/messages \
  -H "Authorization: Bearer $OPENANNOUNCE_PUBLISH_KEY" \
  -H "Idempotency-Key: release-1.5.0" \
  -H "Content-Type: application/json" \
  -d '{"title": "Shop 1.5.0", "body": "- Gift wrapping at checkout", "groups": ["staff"]}'
```

| Field | What it does |
|---|---|
| `title` | Required, up to 200 characters |
| `body` | The text, up to 10,000 characters |
| `groups` | Group slugs; leave out to post for everyone. An unknown slug is a 400 |
| `publishAt` | When it shows (ISO 8601); leave out for now |
| `link` | `{ "url": "https://…", "label": "Read more" }`, optional |

The message is a published News item for the key's system only. `Idempotency-Key` is required:
the same key posts once, ever. A retry gets the first message back with `200` and
`Idempotent-Replayed: true`; the same key with a different message is a `422`.
`GET /api/v1/publish-key` with the key answers which tenant and system it posts to, so a tool can
test the key without posting.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | `postgres://openannounce:openannounce@localhost:5432/openannounce` | The Postgres database. Compose sets it. |
| `POSTGRES_PASSWORD` | `openannounce` | The database password compose uses. Change it on a server. |
| `PORT` | `8080` | The port on this machine. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` or `trace`. |
| `OPENANNOUNCE_PUBLIC_URL` | `http://localhost:8080` | Where people and systems reach OpenAnnounce. Cookies are `Secure` when it's `https://`, and changes posted from other origins are refused. |
| `OPENANNOUNCE_ADMIN_EMAIL` | `admin@example.com` | The first server admin, made on the first start. |
| `OPENANNOUNCE_ADMIN_PASSWORD` | _(made and logged once)_ | That admin's password. |
| `OPENANNOUNCE_SESSION_DAYS` | `30` | How long people stay signed in. |
| `OPENANNOUNCE_FEED_MAX_AGE` | `60` | How long browsers may reuse a feed, in seconds (`Cache-Control: private, max-age`). |
| `OPENANNOUNCE_TRUST_PROXY` | _(off)_ | Behind a reverse proxy: `true`, or the proxy's addresses, so rate limits see real client addresses. |
| `OPENANNOUNCE_DEMO` | `off` | `on` serves the demo host page at `/demo`. |
| `OPENANNOUNCE_FETCH` | `public` | `private` lets integrations reach internal addresses, such as an OpenVersion on the same network. |
| `OPENANNOUNCE_FETCH_ALLOW` | _(none)_ | With `private`: the only hosts allowed to be internal, comma-separated. |
| `OPENANNOUNCE_OPENVERSION_URL` | _(none)_ | Server-wide OpenVersion address, e.g. `https://versions.example.com`. With the public key below, it wins over the Integrations tab, which then shows it read-only. |
| `OPENANNOUNCE_OPENVERSION_PUBLIC_KEY` | _(none)_ | The public key of an OpenVersion environment (`pk_…`). Safe to share. Add this server's address to that environment's allowed origins. |
| `OPENANNOUNCE_OPENVERSION_DEPLOY_TOKEN` | _(none)_ | Lets this server test the connection and publish its own version (`VERSION`) to OpenVersion on start. Keep it secret. Without it, nothing is published. |
| `OPENANNOUNCE_SECRET_KEY` | _(none)_ | Encrypts the saved OpenVersion deploy token. Without it, a key is made and kept in the database, and a warning says so. Set it on a real server, so a database dump alone can't reveal the token. |

**Security.** The database user may be a superuser (the Docker default): every connection drops
to the `openannounce_app` role, which row-level security applies to. If it can't, the server
refuses to start. A system's secret stays on your backend; the browser only gets the public key
and a signed, expiring user token. Sign-in is rate limited per address and email.

## Develop

```sh
npm install
docker run -d --name openannounce-db -e POSTGRES_USER=openannounce \
  -e POSTGRES_PASSWORD=openannounce -e POSTGRES_DB=openannounce -p 5432:5432 postgres:16-alpine
npx nx dev server       # the API on http://localhost:8080
npx nx serve web        # the admin app on http://localhost:4200; /api and /sdk go to the server
```

Before you push, run what CI runs. The server's tests need a database, which they empty first:

```sh
TEST_DATABASE_URL=postgres://openannounce:openannounce@localhost:5432/openannounce_test \
  npx nx run-many -t lint stylelint typecheck test build
```

Without `TEST_DATABASE_URL` those tests are skipped.

Settings also has tests in a real browser (Playwright). They start the server on port 18121 with
a database whose name must end in `_e2e`, and they add tenants to it:

```sh
npx playwright install chromium   # or E2E_CHROME_CHANNEL=chrome to use your installed Chrome
E2E_DATABASE_URL=postgres://openannounce:openannounce@localhost:5432/openannounce_e2e npx nx run web:e2e
```

## Layout

| Folder | What's in it |
|---|---|
| `apps/web` | The admin app (Angular, on the OpenStuff toolkit) |
| `apps/server` | The Fastify API and feed, the migrations and the demo page. In production it also serves the admin app and `/sdk` |
| `packages/announce` | `@openstuff-dev/announce`: the web components, the feed client and `signUser`, published to npm |
| `packages/contracts` | Types the server and admin app share (not published) |
| `site` | The marketing page for https://announce.openstuff.dev |

The theme of the admin app comes from one `primaryColor` in `apps/web/tokens.config.json`.

## Agents

`AGENTS.md` (and `CLAUDE.md`) tell coding agents how to work here and how to use
[OpenPurpose](https://github.com/openstuff-dev/open-purpose) for shared rules.

## Licence

MIT
