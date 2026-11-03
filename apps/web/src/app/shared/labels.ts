import type { Display, Kind, MessageStatus, Role, Severity } from '@open-announce/contracts';

export const roleLabels: Record<Role, string> = {
  admin: 'Admin',
  developer: 'Developer',
};

export const kindLabels: Record<Kind, string> = {
  announcement: 'Announcement',
  maintenance: 'Maintenance',
  news: 'News',
};

export const displayLabels: Record<Display, string> = {
  banner: 'Banner',
  popup: 'Popup',
  popover: 'Popover',
  sidebar: 'Sidebar',
};

export const displayHints: Record<Display, string> = {
  banner: 'A bar at the top of the system.',
  popup: 'A dialog over the page that users close after reading.',
  popover: 'A box in the corner that stays while people work.',
  sidebar: 'In the news sidebar, which users open when they want.',
};

export const severityLabels: Record<Severity, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
};

export const statusLabels: Record<MessageStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

/** "3 Nov, 14:00" in the reader's own language and time zone. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** An ISO time as the value of an <input type="datetime-local">, in local time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
