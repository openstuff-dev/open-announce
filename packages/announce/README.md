# @openstuff-dev/announce

Show [OpenAnnounce](https://github.com/openstuff-dev/open-announce) news, announcements and
maintenance messages in any web app: three web components with no framework of their own, a feed
client, and `signUser` for your backend.

```sh
npm install @openstuff-dev/announce
```

| Import | What it is |
|---|---|
| `@openstuff-dev/announce` | `configure`, `defineConfig`, the types and the display rules. Safe in Node. |
| `@openstuff-dev/announce/announcements` | `<oa-announcements>`: banners users can close, and popups |
| `@openstuff-dev/announce/maintenance` | `<oa-maintenance>`: banners nobody can close, and a corner popover |
| `@openstuff-dev/announce/news` | `<oa-news>`: a news sidebar, opened on demand |
| `@openstuff-dev/announce/server` | `signUser` and `verifyUser`, for your backend (Web Crypto: Node 20+, Deno, Bun, edge) |

## Set it up

```js
// openannounce.config.js
import { defineConfig } from '@openstuff-dev/announce';

export default defineConfig({
  url: 'https://announce.example.com', // your OpenAnnounce server
  publicKey: 'pk_…', // the system's public key
  user: () => fetch('/api/openannounce-token').then((r) => r.text()), // optional
  cacheTtl: 60, // seconds a fetched feed is reused
  refreshInterval: 300, // seconds between checks on an open page; 0 turns it off
});
```

```js
import { configure } from '@openstuff-dev/announce';
import '@openstuff-dev/announce/announcements';
import '@openstuff-dev/announce/maintenance';
import '@openstuff-dev/announce/news';
import config from './openannounce.config.js';

configure(config);
```

```html
<oa-maintenance></oa-maintenance>
<oa-announcements></oa-announcements>
<button class="news-button">What’s new</button>
<oa-news trigger=".news-button"></oa-news>
```

Instead of `configure`, an element also takes `url`, `public-key` and `user-token` attributes, or
a `config` property.

## Sign users

Without a user token, people see only the messages meant for everyone. To show group messages,
your backend signs who is signed in with the system's secret. Never send the secret to the
browser.

```js
import { signUser } from '@openstuff-dev/announce/server';

const token = await signUser(process.env.OPENANNOUNCE_SECRET, {
  sub: user.id,
  groups: ['finance'], // leave out to use the groups an admin set in OpenAnnounce
  exp: Math.floor(Date.now() / 1000) + 3600, // default: in 12 hours
});
```

## Make it look like your app

Every colour, radius and size is a CSS custom property, and every piece is a CSS part:

```css
oa-announcements,
oa-maintenance,
oa-news {
  --oa-font: inherit;
  --oa-radius: 4px;
  --oa-accent: #0a7;
  --oa-info: #eef6ff;
  --oa-warning: #fff6db;
  --oa-critical: #ffe4e4;
  --oa-sidebar-width: 380px;
}

oa-announcements::part(banner) { justify-content: center; }
oa-news::part(item) { padding-block: 24px; }
```

Parts: `banners`, `banner`, `content`, `title`, `body`, `link`, `close`, `popup`, `button`,
`popover`, `item`, `sidebar`, `header`, `heading`, `list`, `date`, `empty`. Add `unstyled` to an
element to drop the default look and keep only what it needs to work.

To render messages yourself, set `renderMessage`. The element keeps the frame (banner, dialog or
popover), the close button and what screen readers hear:

```js
document.querySelector('oa-announcements').renderMessage = (message, { dismiss }) => {
  const el = document.createElement('my-notice');
  el.message = message;
  el.addEventListener('done', dismiss);
  return el;
};
```

Change the built-in text with attributes: `close-label` (all), `ok-label` (popup),
`popover-label` (maintenance), `heading` and `empty-label` (news).

## Events

| Event | `detail` | When |
|---|---|---|
| `openannounce:show` | `{ message }` | A message version shows for the first time |
| `openannounce:dismiss` | `{ message }` | A user closes a message |
| `openannounce:unread` | `{ count }` | The number of unread news items changes (on `<oa-news>`, which also sets `unread`) |

Open the news sidebar with `trigger`, `element.open()`, or
`window.dispatchEvent(new Event('openannounce:news-open'))`.

## Previews and tests

Set `element.messages = [...]` to show those messages without fetching anything.

## Licence

MIT
