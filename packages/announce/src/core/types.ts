/** What a message is about. Each kind has its own element and its own ways to show. */
export type Kind = 'news' | 'announcement' | 'maintenance';

/** How a message shows in the host system. */
export type Display = 'banner' | 'popup' | 'popover' | 'sidebar';

export type Severity = 'info' | 'warning' | 'critical';

export const kinds: readonly Kind[] = ['news', 'announcement', 'maintenance'];
export const displays: readonly Display[] = ['banner', 'popup', 'popover', 'sidebar'];
export const severities: readonly Severity[] = ['info', 'warning', 'critical'];

/** A message as the feed sends it to a host system. */
export interface FeedMessage {
  id: string;
  kind: Kind;
  display: Display;
  severity: Severity;
  title: string;
  /** Plain text. Blank lines start a new paragraph. */
  body: string;
  /** Whether the user can close it. Fixed by the display, except for maintenance popovers. */
  closeable: boolean;
  link: { url: string; label: string } | null;
  startsAt: string | null;
  endsAt: string | null;
  /** Changes on every edit, so an edited message shows again after it was closed. */
  updatedAt: string;
}

export interface Feed {
  messages: FeedMessage[];
}
