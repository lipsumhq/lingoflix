import type { Explanation } from './types';

export interface EpisodeNode {
  key: string;
  videoId: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  entries: Explanation[];
}

export interface SeasonNode {
  key: string;
  seasonNumber: number | null;
  episodes: EpisodeNode[];
  count: number;
}

export interface SeriesNode {
  key: string;
  seriesId: string | null;
  title: string;
  seasons: SeasonNode[];
  count: number;
  updatedAt: string;
}

export interface MovieNode {
  key: string;
  videoId: string;
  title: string;
  entries: Explanation[];
  updatedAt: string;
}

export interface StudyLogTree {
  series: SeriesNode[];
  movies: MovieNode[];
  total: number;
}

/** Numbers ascending, unnumbered last. */
function byNumber(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

const newestFirst = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);
const byTime = (a: Explanation, b: Explanation) => a.videoTimeMs - b.videoTimeMs;

/** Spec §5.5: series by most recently updated; seasons and episodes in numeric order; Movies by most recent. */
export function groupStudyLog(entries: readonly Explanation[]): StudyLogTree {
  const series = new Map<string, SeriesNode>();
  const movies = new Map<string, MovieNode>();

  for (const e of entries) {
    if (e.kind === 'movie') {
      const movie = movies.get(e.videoId) ?? { key: `movie:${e.videoId}`, videoId: e.videoId, title: e.seriesTitle, entries: [], updatedAt: e.updatedAt };
      movie.entries.push(e);
      if (e.updatedAt > movie.updatedAt) movie.updatedAt = e.updatedAt;
      movies.set(e.videoId, movie);
      continue;
    }
    const seriesKey = `series:${e.seriesId ?? e.seriesTitle}`;
    const show = series.get(seriesKey) ?? { key: seriesKey, seriesId: e.seriesId, title: e.seriesTitle, seasons: [], count: 0, updatedAt: e.updatedAt };
    series.set(seriesKey, show);
    if (e.updatedAt > show.updatedAt) show.updatedAt = e.updatedAt;
    show.count++;

    let season = show.seasons.find((s) => s.seasonNumber === e.seasonNumber);
    if (!season) {
      season = { key: `${seriesKey}|season:${e.seasonNumber ?? 'none'}`, seasonNumber: e.seasonNumber, episodes: [], count: 0 };
      show.seasons.push(season);
    }
    season.count++;

    let episode = season.episodes.find((ep) => ep.videoId === e.videoId);
    if (!episode) {
      episode = { key: `episode:${e.videoId}`, videoId: e.videoId, episodeNumber: e.episodeNumber, episodeTitle: e.episodeTitle, entries: [] };
      season.episodes.push(episode);
    }
    episode.entries.push(e);
  }

  const sortedSeries = [...series.values()].sort(newestFirst);
  for (const show of sortedSeries) {
    show.seasons.sort((a, b) => byNumber(a.seasonNumber, b.seasonNumber));
    for (const season of show.seasons) {
      season.episodes.sort((a, b) => byNumber(a.episodeNumber, b.episodeNumber) || a.videoId.localeCompare(b.videoId));
      for (const episode of season.episodes) episode.entries.sort(byTime);
    }
  }
  const sortedMovies = [...movies.values()].sort(newestFirst);
  for (const movie of sortedMovies) movie.entries.sort(byTime);

  return { series: sortedSeries, movies: sortedMovies, total: entries.length };
}
