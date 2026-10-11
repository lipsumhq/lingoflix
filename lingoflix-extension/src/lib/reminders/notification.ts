import { parseShow, type Show } from './store';

/** Reminders spec §4. A new reminder with this id replaces one still on screen. */
export const REMINDER_ID = 'study-reminder';
export const REMINDER_TITLE = 'Time to study';
const NETFLIX_HOME = 'https://www.netflix.com/browse';

export function reminderMessage(show: Show | null): string {
  return show ? `Pick up ${show.title} and learn a few new lines.` : 'Open Netflix and learn a few new lines.';
}

/** The show's Netflix page. The id came from the Netflix page, so it is checked again here (digits only). */
export function reminderUrl(show: Show | null): string {
  const valid = parseShow(show);
  return valid ? `https://www.netflix.com/title/${valid.id}` : NETFLIX_HOME;
}

export function reminderNotification(
  show: Show | null,
  iconUrl: string,
): { type: 'basic'; iconUrl: string; title: string; message: string } {
  return { type: 'basic', iconUrl, title: REMINDER_TITLE, message: reminderMessage(show) };
}
