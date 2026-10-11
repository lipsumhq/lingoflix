import { Bell, Send as SendIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Toggle } from '@/components/Toggle';
import { buttonSecondary, card, focusRing } from '@/components/styles';
import { sendToBackground } from '@/lib/messages';
import { notificationPermission, type NotificationPermission } from '@/lib/reminders/permission';
import { TIME_PATTERN } from '@/lib/reminders/schedule';
import { loadReminders, updateReminders, watchReminders, type Reminders } from '@/lib/reminders/store';
import type { Send } from './ApiKeyCard';

const DAYS = [
  { day: 0, short: 'S', name: 'Sunday' },
  { day: 1, short: 'M', name: 'Monday' },
  { day: 2, short: 'T', name: 'Tuesday' },
  { day: 3, short: 'W', name: 'Wednesday' },
  { day: 4, short: 'T', name: 'Thursday' },
  { day: 5, short: 'F', name: 'Friday' },
  { day: 6, short: 'S', name: 'Saturday' },
] as const;

const NOTICES = {
  declined: "Chrome didn't allow notifications.",
  sent: "Sent. Nothing showed up? Allow notifications for Google Chrome in your computer's settings.",
  failed: "Couldn't send a test reminder.",
} as const;

interface RemindersCardProps {
  send?: Send;
  permission?: NotificationPermission;
}

/** Reminders spec §3. Settings are per computer (`local:reminders`), and the permission is Chrome's. */
export function RemindersCard({ send = sendToBackground, permission = notificationPermission }: RemindersCardProps) {
  const timeId = useId();
  const [reminders, setReminders] = useState<Reminders | null>(null);
  const [granted, setGranted] = useState(false);
  const [draftTime, setDraftTime] = useState('');
  const [notice, setNotice] = useState<keyof typeof NOTICES | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([loadReminders(), permission.has()]).then(([loaded, has]) => {
      if (!active) return;
      setReminders(loaded);
      setDraftTime(loaded.time);
      setGranted(has);
    });
    const unwatch = watchReminders((next) => {
      if (active) setReminders(next);
    });
    const unlisten = permission.onChange((has) => {
      if (active) setGranted(has);
    });
    return () => {
      active = false;
      unwatch();
      unlisten();
    };
  }, [permission]);

  // The field follows the stored time, but not while the learner is mid-edit (an incomplete time reads as '').
  const storedTime = reminders?.time;
  useEffect(() => {
    if (storedTime) setDraftTime(storedTime);
  }, [storedTime]);

  if (!reminders) return null;
  const on = reminders.enabled && granted;

  const save = (fn: (r: Reminders) => Reminders) => void updateReminders(fn).then(setReminders, () => undefined);

  const toggle = (next: boolean) => {
    setNotice(null);
    if (next) {
      // Straight from the click, before any await: Chrome shows its prompt only for a user gesture.
      void permission.request().then(async (allowed) => {
        if (!allowed) {
          setNotice('declined');
          return;
        }
        setGranted(true);
        setReminders(await updateReminders((r) => ({ ...r, enabled: true })));
      });
      return;
    }
    void (async () => {
      setReminders(await updateReminders((r) => ({ ...r, enabled: false })));
      await permission.remove();
      setGranted(false);
    })();
  };

  const toggleDay = (day: number) => {
    if (reminders.days.length === 1 && reminders.days.includes(day)) return; // at least one day
    save((r) => {
      const days = r.days.includes(day) ? r.days.filter((d) => d !== day) : [...r.days, day];
      return days.length > 0 ? { ...r, days } : r; // a quick second tap can't empty the list
    });
  };

  const sendTest = async () => {
    setNotice(null);
    try {
      const { ok } = await send({ type: 'reminder:test' });
      setNotice(ok ? 'sent' : 'failed');
    } catch {
      setNotice('failed');
    }
  };

  return (
    <section aria-labelledby="reminders-heading" className={`${card} px-5 py-4`}>
      <h2 id="reminders-heading" className="flex items-center gap-2 text-[19px] font-black">
        <Bell size={18} strokeWidth={2.5} aria-hidden />
        Reminders
      </h2>
      <p className="mt-0.5 text-sm font-semibold text-mute">A nudge to keep studying with Netflix.</p>

      <div className="mt-2 py-3">
        <Toggle
          label="Study reminders"
          description="Skipped on days you've already watched with LingoFlix on. Chrome needs to be running."
          checked={on}
          onChange={toggle}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-soft py-3">
        <label htmlFor={timeId} className="text-base font-extrabold">
          Time
        </label>
        <input
          id={timeId}
          type="time"
          step={60}
          value={draftTime}
          onChange={(e) => {
            const value = e.target.value;
            setDraftTime(value);
            if (TIME_PATTERN.test(value)) save((r) => ({ ...r, time: value }));
          }}
          className="rounded-xl border-2 border-line bg-card px-3 py-2 text-sm font-bold text-ink outline-none focus:border-brand"
        />
      </div>

      <fieldset className="border-t-2 border-soft py-3">
        <legend className="sr-only">Days</legend>
        <p className="text-base font-extrabold">Days</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {DAYS.map(({ day, short, name }) => {
            const pressed = reminders.days.includes(day);
            const last = pressed && reminders.days.length === 1;
            return (
              <button
                key={day}
                type="button"
                aria-label={name}
                aria-pressed={pressed}
                aria-disabled={last || undefined}
                title={last ? 'Pick at least one day' : undefined}
                onClick={() => toggleDay(day)}
                className={`grid size-10 place-items-center rounded-xl border-2 text-sm font-black ${focusRing} ${
                  pressed ? 'border-tint-line bg-tint text-tint-ink' : 'border-line bg-card text-mute hover:bg-soft'
                } ${last ? 'cursor-not-allowed' : ''}`}
              >
                {short}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="border-t-2 border-soft pt-3">
        <button
          type="button"
          disabled={!on}
          onClick={() => void sendTest()}
          className={`${buttonSecondary} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <SendIcon size={14} strokeWidth={3} aria-hidden />
          Send a test
        </button>
        <p role="status" className="mt-2 text-[13px] font-semibold text-mute empty:hidden">
          {notice ? NOTICES[notice] : ''}
        </p>
      </div>
    </section>
  );
}
