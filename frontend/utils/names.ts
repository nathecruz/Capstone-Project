// First and last names (same rules as backend/lib/names.js). Accounts store both; the full
// name shown in the app is "First Last".
const SURNAME_PARTICLES = new Set(['de', 'del', 'dela', 'delos', 'los', 'las', 'la', 'san', 'santa', 'sta', 'sta.', 'sto', 'sto.', 'santo', 'van', 'von', 'da', 'di', 'du', 'le', 'y']);
const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v']);

/** Best-effort split of an older single full name: "Juan Dela Cruz" -> Juan / Dela Cruz. */
export function splitFullName(fullName?: string | null) {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
  let start = parts.length - 1;
  if (SUFFIXES.has(parts[start].toLowerCase()) && start > 1) start -= 1;
  while (start > 1 && SURNAME_PARTICLES.has(parts[start - 1].toLowerCase())) start -= 1;
  return { firstName: parts.slice(0, start).join(' '), lastName: parts.slice(start).join(' ') };
}

export function joinName(firstName?: string | null, lastName?: string | null) {
  return [firstName, lastName].map((part) => String(part ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean).join(' ');
}

/** First/last name of an account or profile, splitting the full name when they are missing. */
export function namesOf(source: { firstName?: string | null; lastName?: string | null; fullName?: string | null }) {
  if (source.firstName || source.lastName) {
    const firstName = String(source.firstName ?? '').trim();
    const lastName = String(source.lastName ?? '').trim();
    return { firstName, lastName, fullName: joinName(firstName, lastName) };
  }
  const split = splitFullName(source.fullName);
  return { ...split, fullName: String(source.fullName ?? '').trim() };
}
