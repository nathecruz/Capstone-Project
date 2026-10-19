/** The address the web app is published at. */
export const APP_URL = (process.env.EXPO_PUBLIC_APP_URL?.trim() || 'https://capstone-project-indol-five.vercel.app').replace(/\/+$/, '');

type WebLocation = { hostname: string; pathname: string; search: string; hash: string };

/**
 * Vercel also serves every deploy at its own frozen address (capstone-project-<hash>-team-c14.vercel.app).
 * Visitors there would keep an old version of the app, so they are sent to the main address,
 * same page. A branch preview (capstone-project-git-<branch>-team-c14.vercel.app) always serves
 * that branch's latest version, so it stays, and fixes can be tried on a phone before they go live.
 * Other hosts (local development, other hosting) are left alone.
 */
export function canonicalRedirect(location: WebLocation, appUrl = APP_URL): string | null {
  let canonical: URL;
  try {
    canonical = new URL(appUrl);
  } catch {
    return null;
  }
  const host = location.hostname.toLowerCase();
  if (host === canonical.hostname.toLowerCase() || !host.endsWith('.vercel.app') || host.includes('-git-')) return null;
  return `${canonical.origin}${location.pathname}${location.search}${location.hash}`;
}
