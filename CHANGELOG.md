# Changelog

Each release is a Docker image at `ghcr.io/openstuff-dev/open-announce:<version>`.
Migrations run when the new version starts and only move forward, so back up first.

## 0.2.0

Migrations `003_server_integrations`, `004_openversion_deploy_token` and
`005_server_integrations_shape` add the server's connections table. Back up first.

### Web app

- Members, Export and import and Tenants are now tabs in Settings. The old addresses take you to the
  right tab. One-time secrets open in a dialog you can't miss.
- Every new secret and publish key comes with a connection string, and each system has Get a
  connection string for one without its secret. Paste it into another OpenStuff app's Integrations
  tab to connect it.
- New Integrations tab: server admins paste a connection string from OpenVersion and see straight
  away whether it works and how to fix it. Admins see which systems post here, with a link to
  Systems.
- With OpenVersion connected, open tabs offer to reload when a new version is live.
- Moved onto `@openstuff-dev/ui` 0.1.8 and `ui-angular` 0.1.9.

### Server

- With an OpenVersion deploy token saved, the server publishes its own version on start.
- New settings: `OPENANNOUNCE_SECRET_KEY` encrypts the saved keys. Without it, a key is made and kept
  in the database, with a warning in the log. Set it before connecting anything, because changing it
  later means entering the keys again. `OPENANNOUNCE_FETCH` and `OPENANNOUNCE_FETCH_ALLOW` control
  which addresses a connection may reach. `OPENANNOUNCE_OPENVERSION_*` sets the connection from the
  environment, and its card becomes read only.
- Saved connection secrets never leave the server: not in the admin list, not in a tenant's export.

### Image

- The image carries its own version (`VERSION` build arg), so the server reports it and the web app
  knows it.

## 0.1.1

No migrations.

- The browser tab now shows OpenAnnounce's real mark, the OpenStuff ring with its glyph, instead of a plain coloured square.
- A missing file now answers 404 instead of the web app, so a tab on an old build recovers instead of showing a blank page.
- The first admin's log line now points to Settings, where the password is changed.
- Moved onto `@openstuff-dev/ui` and `ui-angular` 0.1.6.

## 0.1.0

The first release with a published image.
