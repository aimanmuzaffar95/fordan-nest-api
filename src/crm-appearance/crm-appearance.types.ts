export type CrmThemePreference = 'system' | 'light' | 'dark';

export type CrmAppearanceSettings = {
  appDisplayName: string;
  /** Shown on the login screen under the title. */
  loginTagline: string | null;
  /** Shown under the app name in the sidebar when expanded. */
  sidebarSubtitle: string | null;
  /** Suffix for `document.title` (e.g. "Operations CRM"). */
  browserTitleSuffix: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  /** Optional `#rrggbb` or `#rgb` brand color; drives primary UI tokens when set. */
  primaryBrandHex: string | null;
  themePreference: CrmThemePreference;
  /** Tighter sidebar nav density. */
  compactSidebar: boolean;
  /** Hide dev-style quick credential buttons on the login page. */
  loginHideQuickFill: boolean;
};
