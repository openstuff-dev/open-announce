/**
 * The default look. Every value is a custom property, so a host restyles it from outside:
 *
 * ```css
 * oa-announcements { --oa-radius: 0; --oa-accent: #0a7; }
 * oa-announcements::part(banner) { font-size: 14px; }
 * ```
 *
 * `unstyled` on an element drops all of this and keeps only what it needs to work.
 */
export const baseCss = `
:host {
  --oa-font: inherit;
  --oa-radius: 8px;
  --oa-gap: 12px;
  --oa-bg: light-dark(#ffffff, #1c1c1f);
  --oa-fg: light-dark(#1c1c1f, #ededef);
  --oa-muted: light-dark(#5f5f66, #a1a1aa);
  --oa-border: light-dark(#e4e4e7, #34343a);
  --oa-accent: light-dark(#2d5bff, #7c9aff);
  --oa-info: light-dark(#e8efff, #1d2a4d);
  --oa-warning: light-dark(#fff4d6, #4a3a10);
  --oa-critical: light-dark(#ffe1e1, #561d1d);
  --oa-shadow: 0 12px 32px rgb(0 0 0 / 0.18);
  --oa-z: 2147483000;
  --oa-sidebar-width: min(420px, 100vw);
  display: block;
  font-family: var(--oa-font);
  color: var(--oa-fg);
}
:host([hidden]) { display: none; }
* { box-sizing: border-box; }
.title { margin: 0; font-weight: 600; font-size: 1em; }
.body { margin: 0; color: inherit; }
.body p { margin: 0 0 0.5em; }
.body p:last-child { margin-block-end: 0; }
.link { color: var(--oa-accent); font-weight: 500; }
.content { display: grid; gap: 4px; min-inline-size: 0; flex: 1; overflow-wrap: anywhere; }
.close {
  flex: none;
  display: inline-grid;
  place-items: center;
  inline-size: 32px;
  block-size: 32px;
  margin: -4px -4px -4px 0;
  border: 0;
  border-radius: calc(var(--oa-radius) / 2);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.close:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.close:focus-visible, .link:focus-visible { outline: 2px solid var(--oa-accent); outline-offset: 2px; }
.banners { display: grid; gap: 1px; }
.banner {
  display: flex;
  align-items: flex-start;
  gap: var(--oa-gap);
  padding: 10px 16px;
  background: var(--oa-info);
  line-height: 1.45;
}
.banner[data-severity='warning'] { background: var(--oa-warning); }
.banner[data-severity='critical'] { background: var(--oa-critical); }
.surface {
  border: 1px solid var(--oa-border);
  border-radius: var(--oa-radius);
  background: var(--oa-bg);
  color: var(--oa-fg);
  box-shadow: var(--oa-shadow);
  font-family: var(--oa-font);
  line-height: 1.5;
}
.popup {
  inline-size: min(480px, calc(100vw - 32px));
  padding: 20px;
}
.popup::backdrop { background: rgb(0 0 0 / 0.4); }
.popup .head { display: flex; align-items: flex-start; gap: var(--oa-gap); margin-block-end: 8px; }
.popup .title { font-size: 1.15em; flex: 1; }
.popup .actions { display: flex; justify-content: flex-end; margin-block-start: 16px; }
.button {
  border: 0;
  border-radius: calc(var(--oa-radius) / 1.5);
  padding: 8px 14px;
  background: var(--oa-accent);
  color: light-dark(#fff, #0b0b0c);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.button:focus-visible { outline: 2px solid var(--oa-accent); outline-offset: 2px; }
/* The popover is placed on the element with the popover attribute itself. */
.popover {
  position: fixed;
  inset: auto 16px 16px auto;
  margin: 0;
  inline-size: min(380px, calc(100vw - 32px));
  max-block-size: calc(100vh - 32px);
  overflow: auto;
  padding: 0;
  z-index: var(--oa-z);
}
.popover .item { display: flex; gap: var(--oa-gap); padding: 14px 16px; border-inline-start: 4px solid var(--oa-warning); }
.popover .item[data-severity='info'] { border-inline-start-color: var(--oa-accent); }
.popover .item[data-severity='critical'] { border-inline-start-color: light-dark(#d92d20, #ff6b5e); }
.popover .item + .item { border-block-start: 1px solid var(--oa-border); }
.sidebar {
  position: fixed;
  inset: 0 0 0 auto;
  margin: 0;
  inline-size: var(--oa-sidebar-width);
  max-inline-size: 100vw;
  block-size: 100dvh;
  max-block-size: 100dvh;
  padding: 0;
  border-block: 0;
  border-inline-end: 0;
  border-radius: 0;
  display: none;
  flex-direction: column;
}
.sidebar[open] { display: flex; }
.sidebar::backdrop { background: rgb(0 0 0 / 0.3); }
.sidebar .head { display: flex; align-items: center; gap: var(--oa-gap); padding: 16px 20px; border-block-end: 1px solid var(--oa-border); }
.sidebar .head .title { font-size: 1.15em; flex: 1; }
.sidebar .list { list-style: none; margin: 0; padding: 0; overflow: auto; flex: 1; }
.sidebar .item { display: grid; gap: 6px; padding: 16px 20px; border-block-end: 1px solid var(--oa-border); }
.sidebar .item[data-unread] .title::after { content: ''; display: inline-block; inline-size: 8px; block-size: 8px; margin-inline-start: 8px; border-radius: 50%; background: var(--oa-accent); vertical-align: middle; }
.sidebar .date { color: var(--oa-muted); font-size: 0.85em; }
.sidebar .empty { padding: 32px 20px; color: var(--oa-muted); }
@media (prefers-reduced-motion: no-preference) {
  .popup[open], .popover:popover-open { animation: oa-rise 160ms ease-out; }
  .sidebar[open] { animation: oa-slide 200ms ease-out; }
}
@keyframes oa-rise { from { opacity: 0; translate: 0 8px; } }
@keyframes oa-slide { from { translate: 100% 0; } }
`;

/** What the elements need to work at all, kept with `unstyled`. */
export const structuralCss = `
:host { display: block; }
:host([hidden]) { display: none; }
.popover { position: fixed; inset: auto 16px 16px auto; margin: 0; }
.sidebar { position: fixed; inset: 0 0 0 auto; margin: 0; block-size: 100dvh; max-block-size: 100dvh; }
`;

const sheets = new Map<string, CSSStyleSheet>();

export function sheet(css: string): CSSStyleSheet {
  let s = sheets.get(css);
  if (!s) {
    s = new CSSStyleSheet();
    s.replaceSync(css);
    sheets.set(css, s);
  }
  return s;
}
