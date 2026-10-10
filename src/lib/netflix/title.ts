/** What the learner is watching (spec §5.5 entry fields, §8.3). */
export interface TitleInfo {
  videoId: string;
  kind: 'episode' | 'movie';
  seriesId: string | null;
  /** Series title, or the movie title. */
  seriesTitle: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const idString = (value: unknown): string | null =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : null;

/** From `videoMetadata[videoId]._metadataObject.video` (docs/netflix-internals.md row 4). */
export function titleFromMetadata(video: unknown, videoId: string): TitleInfo | null {
  if (!isRecord(video) || typeof video.title !== 'string' || !video.title) return null;
  if (video.type === 'movie') {
    return { videoId, kind: 'movie', seriesId: null, seriesTitle: video.title, seasonNumber: null, episodeNumber: null, episodeTitle: null };
  }
  if (video.type !== 'show') return null;
  const base: TitleInfo = {
    videoId,
    kind: 'episode',
    seriesId: idString(video.id),
    seriesTitle: video.title,
    seasonNumber: null,
    episodeNumber: null,
    episodeTitle: null,
  };
  for (const season of Array.isArray(video.seasons) ? video.seasons : []) {
    if (!isRecord(season) || !Array.isArray(season.episodes)) continue;
    for (const episode of season.episodes) {
      if (!isRecord(episode)) continue;
      if (idString(episode.id) !== videoId && idString(episode.episodeId) !== videoId) continue;
      return {
        ...base,
        seasonNumber: typeof season.seq === 'number' ? season.seq : null,
        episodeNumber: typeof episode.seq === 'number' ? episode.seq : null,
        episodeTitle: typeof episode.title === 'string' ? episode.title : null,
      };
    }
  }
  return base;
}

const EPISODE_LABEL = /^(?:S(\d+)\s*:\s*)?E(\d+)$/i;

/** Fallback: the player's title block `[data-uia="video-title"]` = h4 (series) + "S1:E3"/"E1" + episode title. */
export function titleFromDom(doc: Document, videoId: string): TitleInfo | null {
  const block = doc.querySelector('[data-uia="video-title"]');
  if (!block) return null;
  const heading = block.querySelector('h4')?.textContent?.trim();
  if (heading) {
    const spans = [...block.querySelectorAll('span')].map((s) => s.textContent?.trim() ?? '').filter(Boolean);
    const label = spans.map((s) => EPISODE_LABEL.exec(s)).find((m) => m !== null) ?? null;
    return {
      videoId,
      kind: 'episode',
      seriesId: null,
      seriesTitle: heading,
      seasonNumber: label?.[1] ? Number(label[1]) : null,
      episodeNumber: label?.[2] ? Number(label[2]) : null,
      episodeTitle: spans.find((s) => !EPISODE_LABEL.test(s)) ?? null,
    };
  }
  const text = block.textContent?.trim();
  return text
    ? { videoId, kind: 'movie', seriesId: null, seriesTitle: text, seasonNumber: null, episodeNumber: null, episodeTitle: null }
    : null;
}
