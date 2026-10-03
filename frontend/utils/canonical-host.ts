/** The address the web app is published at. */
export const APP_URL = (process.env.EXPO_PUBLIC_APP_URL?.trim() || 'https://capstone-project-indol-five.vercel.app').replace(/\/+$/, '');

type WebLocation = { hostname: string; pathname: string; search: string; hash: string };

/**
 * Vercel also serves every deploy at its own frozen address (capstone-project-<hash>-team-c14.vercel.app).
 * Visitors there would keep an old version of the app, so they are sent to the main address,
 * same page. Other hosts (local development, other hosting) are left alone.
 */
export function canonicalRedirect(location: WebLocation, appUrl = APP_URL): string | null {
  let canonical: URL;
  try {
    canonical = new URL(appUrl);
  } catch {
    return null;
  }
  const host = location.hostname.toLowerCase();
  if (host === canonical.hostname.toLowerCase() || !host.endsWith('.vercel.app')) return null;
  return `${canonical.origin}${location.pathname}${location.search}${location.hash}`;
}
