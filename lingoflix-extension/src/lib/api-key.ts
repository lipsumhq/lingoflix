import { storage } from '#imports';

/** chrome.storage.local `apiKey` — never synced; read only by the background worker (spec §6.4). */
const API_KEY = 'local:apiKey';

export async function getApiKey(): Promise<string | null> {
  const value = await storage.getItem<string>(API_KEY);
  return typeof value === 'string' && value.trim() ? value : null;
}

export async function setApiKey(key: string): Promise<void> {
  await storage.setItem(API_KEY, key.trim());
}

export async function removeApiKey(): Promise<void> {
  await storage.removeItem(API_KEY);
}

/** "sk-ant-…wxyz": enough to recognize the key, never enough to use it. */
export function maskApiKey(key: string): string {
  return key.length <= 12 ? '••••' : `${key.slice(0, 7)}…${key.slice(-4)}`;
}
