import type { Display, FeedMessage, Kind, Severity } from '@openstuff-dev/announce';

export type { Display, FeedMessage, Kind, Severity };

/** What a member may do in a tenant. Admins manage everything; developers set up systems. */
export type Role = 'admin' | 'developer';
export type MessageStatus = 'draft' | 'published' | 'archived';

export interface Me {
  id: string;
  email: string;
  name: string;
  isServerAdmin: boolean;
  tenants: { slug: string; name: string; role: Role }[];
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
}

export interface Member {
  accountId: string;
  email: string;
  name: string;
  role: Role;
}

/** Returned once, when an account is made for a new member. */
export interface NewMember extends Member {
  password: string | null;
}

export interface System {
  id: string;
  slug: string;
  name: string;
  publicKey: string;
  /** The first characters of the secret, so people can tell which one is in use. */
  secretHint: string;
  /** Origins that may read the feed, e.g. https://app.example.com. Empty: any origin. */
  allowedOrigins: string[];
  createdAt: string;
}

/** Returned once, when a system is made or its secret is replaced. */
export interface SystemWithSecret extends System {
  signingSecret: string;
}

export interface Group {
  id: string;
  slug: string;
  name: string;
  userCount: number;
}

export interface EndUser {
  id: string;
  externalId: string;
  name: string;
  groupIds: string[];
}

export interface Message {
  id: string;
  kind: Kind;
  display: Display;
  severity: Severity;
  title: string;
  body: string;
  closeable: boolean;
  linkUrl: string | null;
  linkLabel: string | null;
  status: MessageStatus;
  startsAt: string | null;
  endsAt: string | null;
  /** Empty: every system. */
  systemIds: string[];
  /** Empty: everyone. */
  groupIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MessageInput {
  kind: Kind;
  display: Display;
  severity: Severity;
  title: string;
  body: string;
  closeable?: boolean;
  linkUrl?: string | null;
  linkLabel?: string | null;
  status: MessageStatus;
  startsAt?: string | null;
  endsAt?: string | null;
  systemIds: string[];
  groupIds: string[];
}

/** The messages page in one request: the list and what it can be targeted at. */
export interface MessagesPage {
  messages: Message[];
  systems: Pick<System, 'id' | 'name'>[];
  groups: Pick<Group, 'id' | 'name'>[];
}

/** Everything a tenant holds, except secrets. Importing makes new keys for its systems. */
export interface TenantExport {
  format: 'openannounce-export';
  version: 1;
  exportedAt: string;
  tenant: { slug: string; name: string };
  systems: { slug: string; name: string; allowedOrigins: string[] }[];
  groups: { slug: string; name: string }[];
  users: { externalId: string; name: string; groups: string[] }[];
  messages: (Omit<MessageInput, 'systemIds' | 'groupIds'> & {
    systems: string[];
    groups: string[];
    createdAt: string;
    updatedAt: string;
  })[];
}

export interface ApiError {
  error: string;
}
