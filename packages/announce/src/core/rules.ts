import type { Display, Kind } from './types.js';

/**
 * Which displays each kind allows, and whether the user can close them there.
 * `'admin'` means the admin decides per message.
 */
export const displayRules: Readonly<Record<Kind, Partial<Record<Display, boolean | 'admin'>>>> = {
  announcement: { banner: true, popup: true },
  maintenance: { banner: false, popover: 'admin' },
  news: { sidebar: true },
};

export function allowedDisplays(kind: Kind): Display[] {
  return Object.keys(displayRules[kind]) as Display[];
}

/** Whether the admin chooses if a message of this kind and display can be closed. */
export function closeableIsChoice(kind: Kind, display: Display): boolean {
  return displayRules[kind][display] === 'admin';
}

export type DisplayCheck =
  | { ok: true; display: Display; closeable: boolean } |
  { ok: false; error: string };

/**
 * Checks a display against its kind and settles `closeable`: fixed where the display decides,
 * the admin's choice (default closeable) where it doesn't.
 */
export function resolveDisplay(kind: Kind, display: Display, closeable?: boolean): DisplayCheck {
  const rule = displayRules[kind][display];
  if (rule === undefined) {
    const allowed = allowedDisplays(kind).join(' or ');
    return { ok: false, error: `A ${kind} message shows as ${allowed}, not as ${display}.` };
  }
  return { ok: true, display, closeable: rule === 'admin' ? (closeable ?? true) : rule };
}
