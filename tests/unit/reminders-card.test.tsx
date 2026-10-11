// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { RemindersCard } from '@/entrypoints/options/RemindersCard';
import type { sendToBackground } from '@/lib/messages';
import type { NotificationPermission } from '@/lib/reminders/permission';
import { loadReminders, updateReminders } from '@/lib/reminders/store';

beforeEach(() => fakeBrowser.reset());
afterEach(cleanup);

function fakePermission({ granted = false, allow = true } = {}) {
  const state = { granted };
  const listeners = new Set<(granted: boolean) => void>();
  const permission = {
    has: vi.fn(async () => state.granted),
    request: vi.fn(async () => {
      if (allow) state.granted = true;
      return allow;
    }),
    remove: vi.fn(async () => {
      state.granted = false;
    }),
    onChange: (callback: (granted: boolean) => void) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  } satisfies NotificationPermission;
  const revoke = () => {
    state.granted = false;
    for (const listener of listeners) listener(false);
  };
  return { permission, revoke };
}

const fakeSend = (reply: () => Promise<{ ok: boolean }>) => vi.fn(reply) as unknown as typeof sendToBackground;
const reminderSwitch = () => screen.findByRole('switch', { name: 'Study reminders' });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('Reminders card', () => {
  it('starts off; turning it on asks Chrome right in the click, then saves it', async () => {
    const { permission } = fakePermission();
    render(<RemindersCard permission={permission} send={fakeSend(async () => ({ ok: true }))} />);
    expect(await screen.findByRole('heading', { name: 'Reminders' })).toBeTruthy();
    const toggle = await reminderSwitch();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText("Skipped on days you've already watched with LingoFlix on. Chrome needs to be running.")).toBeTruthy();
    fireEvent.click(toggle);
    expect(permission.request).toHaveBeenCalledTimes(1); // no await before it: Chrome needs the click
    await waitFor(async () => expect((await loadReminders()).enabled).toBe(true));
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  });

  it('stays off and says so when Chrome is not allowed to show notifications', async () => {
    const { permission } = fakePermission({ allow: false });
    render(<RemindersCard permission={permission} send={fakeSend(async () => ({ ok: true }))} />);
    fireEvent.click(await reminderSwitch());
    expect(await screen.findByText("Chrome didn't allow notifications.")).toBeTruthy();
    expect((await reminderSwitch()).getAttribute('aria-checked')).toBe('false');
    expect((await loadReminders()).enabled).toBe(false);
  });

  it('turning it off saves that and gives the permission back', async () => {
    await updateReminders((r) => ({ ...r, enabled: true }));
    const { permission } = fakePermission({ granted: true });
    render(<RemindersCard permission={permission} send={fakeSend(async () => ({ ok: true }))} />);
    const toggle = await reminderSwitch();
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(toggle);
    await waitFor(() => expect(permission.remove).toHaveBeenCalledTimes(1));
    expect((await loadReminders()).enabled).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('shows off when the permission is missing or removed elsewhere', async () => {
    await updateReminders((r) => ({ ...r, enabled: true }));
    const missing = fakePermission({ granted: false });
    const { unmount } = render(<RemindersCard permission={missing.permission} send={fakeSend(async () => ({ ok: true }))} />);
    await settle();
    expect((await reminderSwitch()).getAttribute('aria-checked')).toBe('false');
    unmount();

    const granted = fakePermission({ granted: true });
    render(<RemindersCard permission={granted.permission} send={fakeSend(async () => ({ ok: true }))} />);
    const toggle = await reminderSwitch();
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    granted.revoke();
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });

  it('saves a full time, and an incomplete one is neither saved nor snapped back', async () => {
    const { permission } = fakePermission();
    render(<RemindersCard permission={permission} send={fakeSend(async () => ({ ok: true }))} />);
    const input = (await screen.findByLabelText('Time')) as HTMLInputElement;
    expect(input.value).toBe('20:00');
    fireEvent.change(input, { target: { value: '07:30' } });
    await waitFor(async () => expect((await loadReminders()).time).toBe('07:30'));
    fireEvent.change(input, { target: { value: '' } });
    await settle();
    expect(input.value).toBe('');
    expect((await loadReminders()).time).toBe('07:30');
  });

  it('days toggle, and the last one left cannot be turned off', async () => {
    await updateReminders((r) => ({ ...r, days: [1] }));
    const { permission } = fakePermission();
    render(<RemindersCard permission={permission} send={fakeSend(async () => ({ ok: true }))} />);
    const monday = await screen.findByRole('button', { name: 'Monday' });
    expect(monday.textContent).toBe('M');
    expect(monday.getAttribute('aria-pressed')).toBe('true');
    expect(monday.getAttribute('aria-disabled')).toBe('true');
    expect(monday.getAttribute('title')).toBe('Pick at least one day');
    fireEvent.click(monday);
    await settle();
    expect((await loadReminders()).days).toEqual([1]);

    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    await waitFor(async () => expect((await loadReminders()).days).toEqual([1, 3]));
    await waitFor(() => expect(monday.getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(monday);
    await waitFor(async () => expect((await loadReminders()).days).toEqual([3]));
  });

  it('two quick taps can never leave no day (which would read as every day)', async () => {
    await updateReminders((r) => ({ ...r, days: [1, 3] }));
    const { permission } = fakePermission();
    render(<RemindersCard permission={permission} send={fakeSend(async () => ({ ok: true }))} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Monday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    await waitFor(async () => expect((await loadReminders()).days).toEqual([3]));
    await settle();
    expect((await loadReminders()).days).toEqual([3]);
  });

  it('Send a test works only while on, and shows the hint or the failure', async () => {
    const { permission } = fakePermission();
    const replies = [{ ok: true }, { ok: false }];
    const send = fakeSend(async () => replies.shift() ?? { ok: false });
    render(<RemindersCard permission={permission} send={send} />);
    const button = (await screen.findByRole('button', { name: 'Send a test' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(await reminderSwitch());
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect(
      await screen.findByText("Sent. Nothing showed up? Allow notifications for Google Chrome in your computer's settings."),
    ).toBeTruthy();
    expect(send).toHaveBeenCalledWith({ type: 'reminder:test' });
    fireEvent.click(button);
    expect(await screen.findByText("Couldn't send a test reminder.")).toBeTruthy();
  });
});
