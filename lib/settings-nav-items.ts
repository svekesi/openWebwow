/**
 * Settings navigation items for the settings sidebar.
 * Extracted for reuse and to allow cloud overlay to filter items.
 */

export interface SettingsNavItem {
  id: string;
  label: string;
  path: string;
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { id: 'general', label: 'General', path: '/webwow/settings/general' },
  { id: 'users', label: 'Users', path: '/webwow/settings/users' },
  { id: 'redirects', label: 'Redirects', path: '/webwow/settings/redirects' },
  { id: 'email', label: 'Email', path: '/webwow/settings/email' },
  { id: 'templates', label: 'Templates', path: '/webwow/settings/templates' },
  { id: 'updates', label: 'Updates', path: '/webwow/settings/updates' },
];
