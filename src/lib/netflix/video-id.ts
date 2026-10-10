const WATCH_PATH = /^\/watch\/(\d+)(?:\/|$)/;

export function parseWatchVideoId(pathname: string): string | null {
  return WATCH_PATH.exec(pathname)?.[1] ?? null;
}

export function isWatchPath(pathname: string): boolean {
  return WATCH_PATH.test(pathname);
}
