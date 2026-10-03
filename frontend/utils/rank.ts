/** How a student's leaderboard place is described on the Profile (from the server's All Time ranking). */
export function rankSummary(rank: number, total: number) {
  const share = total > 0 ? rank / total : 1;
  const topPercent = Math.max(1, Math.ceil(share * 100));
  const title = rank === 1 ? 'Top of the class' : share <= 0.1 ? 'Top performer' : share <= 0.25 ? 'Rising star' : share <= 0.5 ? 'Steady climber' : 'Keep climbing';
  // "Top 100%" for the last place reads oddly: the top half sees its percentage, the rest a nudge.
  const standing = share <= 0.5 ? `Top ${topPercent}%` : 'Every check-in counts';
  return { title, topPercent, standing, of: `of ${total} student${total === 1 ? '' : 's'}` };
}
