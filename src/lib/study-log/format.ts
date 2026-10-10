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

interface Where {
  kind: 'episode' | 'movie';
  seasonNumber: number | null;
  episodeNumber: number | null;
}

/** "S1 E3", "E3", "S1", or "" for movies and unnumbered episodes (v2 spec §6.1 rows). */
export function episodeCode(fields: Where): string {
  if (fields.kind === 'movie') return '';
  return [fields.seasonNumber !== null ? `S${fields.seasonNumber}` : null, fields.episodeNumber !== null ? `E${fields.episodeNumber}` : null]
    .filter(Boolean)
    .join(' ');
}

/** "Stranger Things S1 E3", or the movie's title (v2 spec §5.2 learning history). */
export function whereLabel(fields: Where & { seriesTitle: string }): string {
  const code = episodeCode(fields);
  return code ? `${fields.seriesTitle} ${code}` : fields.seriesTitle;
}
