import { storage } from '#imports';

/** "Open at this moment" (spec §5.5): kept in chrome.storage.session until the watch page takes it. */
export interface PendingSeek {
  videoId: string;
  timeMs: number;
  createdAt: number;
}

export const PENDING_SEEK_MAX_AGE_MS = 120_000;
const PENDING_SEEK_KEY = 'session:pendingSeek';

export async function setPendingSeek(videoId: string, timeMs: number, now: number = Date.now()): Promise<void> {
  await storage.setItem<PendingSeek>(PENDING_SEEK_KEY, { videoId, timeMs, createdAt: now });
}

/** The time to seek to if a fresh pending seek is for this video; it is consumed when taken, dropped when stale. */
export async function takePendingSeek(videoId: string, now: number = Date.now()): Promise<number | null> {
  const pending = await storage.getItem<PendingSeek>(PENDING_SEEK_KEY);
  if (!pending || typeof pending.timeMs !== 'number' || typeof pending.createdAt !== 'number') return null;
  if (now - pending.createdAt > PENDING_SEEK_MAX_AGE_MS) {
    await storage.removeItem(PENDING_SEEK_KEY);
    return null;
  }
  if (pending.videoId !== videoId) return null;
  await storage.removeItem(PENDING_SEEK_KEY);
  return pending.timeMs;
}
