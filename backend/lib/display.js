/** "Juan Dela Cruz" -> "Juan C." — leaderboards never show other students' full names. */
export function leaderboardName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Student';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts.at(-1)[0].toUpperCase()}.`;
}
