import type { SavedItem } from './types';

export interface EpisodeNode {
  key: string;
  videoId: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  items: SavedItem[];
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
  items: SavedItem[];
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

const recentlyUpdatedFirst = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);
/** Where the line is in the episode; items from the same line in the order they were saved. */
const byLineTime = (a: SavedItem, b: SavedItem) => a.lineTimeMs - b.lineTimeMs || a.savedAt.localeCompare(b.savedAt);

/** v2 spec §6.1 (main spec §5.5 order): series by most recently updated; seasons and episodes in numeric order; Movies by most recent. */
export function groupStudyLog(items: readonly SavedItem[]): StudyLogTree {
  const series = new Map<string, SeriesNode>();
  const movies = new Map<string, MovieNode>();

  for (const item of items) {
    if (item.kind === 'movie') {
      const movie = movies.get(item.videoId) ?? {
        key: `movie:${item.videoId}`,
        videoId: item.videoId,
        title: item.seriesTitle,
        items: [],
        updatedAt: item.updatedAt,
      };
      movie.items.push(item);
      if (item.updatedAt > movie.updatedAt) movie.updatedAt = item.updatedAt;
      movies.set(item.videoId, movie);
      continue;
    }
    const seriesKey = `series:${item.seriesId ?? item.seriesTitle}`;
    const show = series.get(seriesKey) ?? {
      key: seriesKey,
      seriesId: item.seriesId,
      title: item.seriesTitle,
      seasons: [],
      count: 0,
      updatedAt: item.updatedAt,
    };
    series.set(seriesKey, show);
    if (item.updatedAt > show.updatedAt) show.updatedAt = item.updatedAt;
    show.count++;

    let season = show.seasons.find((s) => s.seasonNumber === item.seasonNumber);
    if (!season) {
      season = { key: `${seriesKey}|season:${item.seasonNumber ?? 'none'}`, seasonNumber: item.seasonNumber, episodes: [], count: 0 };
      show.seasons.push(season);
    }
    season.count++;

    let episode = season.episodes.find((ep) => ep.videoId === item.videoId);
    if (!episode) {
      episode = { key: `episode:${item.videoId}`, videoId: item.videoId, episodeNumber: item.episodeNumber, episodeTitle: item.episodeTitle, items: [] };
      season.episodes.push(episode);
    }
    episode.items.push(item);
  }

  const sortedSeries = [...series.values()].sort(recentlyUpdatedFirst);
  for (const show of sortedSeries) {
    show.seasons.sort((a, b) => byNumber(a.seasonNumber, b.seasonNumber));
    for (const season of show.seasons) {
      season.episodes.sort((a, b) => byNumber(a.episodeNumber, b.episodeNumber) || a.videoId.localeCompare(b.videoId));
      for (const episode of season.episodes) episode.items.sort(byLineTime);
    }
  }
  const sortedMovies = [...movies.values()].sort(recentlyUpdatedFirst);
  for (const movie of sortedMovies) movie.items.sort(byLineTime);

  return { series: sortedSeries, movies: sortedMovies, total: items.length };
}
