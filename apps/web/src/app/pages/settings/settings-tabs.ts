import type { Role } from '@open-announce/contracts';
import {
  iconAccount,
  iconAppearance,
  iconData,
  iconIntegrations,
  iconMembers,
  iconTenants,
} from '../../shared/icons';

/** The groups of the Settings menu, in the order they show. */
export type SettingsGroupKey = 'you' | 'tenant' | 'server';

/** Who is looking: their role in the tenant in the URL (none outside one), and whether they
 * run the server. */
export interface Who {
  readonly role: Role | null;
  readonly isServerAdmin: boolean;
}

export type SettingsTabId = 'account' | 'appearance' | 'members' | 'integrations' | 'data' | 'tenants';

export interface SettingsTab {
  readonly id: SettingsTabId;
  readonly label: string;
  readonly icon: typeof iconAccount;
  readonly group: SettingsGroupKey;
  /** Whether this person sees the tab. The server still decides what they may change. */
  readonly visible: (who: Who) => boolean;
}

const everyone = () => true;
const admin = (who: Who) => who.role === 'admin';

/** Every Settings tab. The menu and the redirects both read this list. */
export const SETTINGS_TABS: readonly SettingsTab[] = [
  { id: 'account', label: 'Account', icon: iconAccount, group: 'you', visible: everyone },
  { id: 'appearance', label: 'Appearance', icon: iconAppearance, group: 'you', visible: everyone },
  { id: 'members', label: 'Members', icon: iconMembers, group: 'tenant', visible: admin },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: iconIntegrations,
    group: 'tenant',
    visible: (who) => who.role === 'admin' || who.isServerAdmin,
  },
  { id: 'data', label: 'Export and import', icon: iconData, group: 'tenant', visible: admin },
  { id: 'tenants', label: 'Tenants', icon: iconTenants, group: 'server', visible: (who) => who.isServerAdmin },
];

/** The tabs this person may open, in menu order. */
export function tabsFor(who: Who): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => tab.visible(who));
}

export function isTabId(id: string): id is SettingsTabId {
  return SETTINGS_TABS.some((tab) => tab.id === id);
}
