/** "30:34", or "1:02:03" past an hour — like Netflix's player. */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

export function seasonLabel(seasonNumber: number | null): string {
  return seasonNumber === null ? 'Episodes' : `Season ${seasonNumber}`;
}

export function episodeLabel(episode: { episodeNumber: number | null; episodeTitle: string | null }): string {
  const parts = [episode.episodeNumber !== null ? `E${episode.episodeNumber}` : null, episode.episodeTitle];
  return parts.filter(Boolean).join(' · ') || 'Episode';
}
