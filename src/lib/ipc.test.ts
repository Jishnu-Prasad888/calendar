import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences } from '../domain';
import { createDemoClient, createDemoStore, createTauriClient } from './ipc';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

beforeEach(() => invokeMock.mockReset());

describe('demo IPC client', () => {
  it('creates, updates, responds to, and deletes events in memory', async () => {
    const store = createDemoStore(new Date('2026-07-20T12:00:00Z'));
    const client = createDemoClient(store);
    const created = await client.createEvent({
      calendarId: 'primary',
      title: 'Release review',
      start: '2026-07-22T10:00:00Z',
      end: '2026-07-22T11:00:00Z',
      allDay: false,
      attendees: ['alex.morgan@example.com'],
    });

    expect(created.title).toBe('Release review');
    const updated = await client.updateEvent(created.id, 'primary', {
      title: 'Release readiness review',
    });
    expect(updated.title).toBe('Release readiness review');

    await client.deleteEvent(created.id, 'primary');
    const events = await client.getEvents(
      '2026-07-22T00:00:00Z',
      '2026-07-23T00:00:00Z',
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ id: created.id }),
    );
  });

  it('protects read-only events and updates preferences', async () => {
    const client = createDemoClient(
      createDemoStore(new Date('2026-07-20T12:00:00Z')),
    );
    await expect(
      client.updateEvent('event-holiday', 'holidays', { title: 'Changed' }),
    ).rejects.toThrow('read-only');

    const current = (await client.bootstrap()).preferences;
    const preferences = await client.updatePreferences({
      ...current,
      theme: 'dark',
      weekStartsOn: 0,
    });
    expect(preferences).toMatchObject({ theme: 'dark', weekStartsOn: 0 });
  });

  it('uses camelCase Tauri arguments and sends complete preferences', async () => {
    const client = createTauriClient();
    const preferences: Preferences = {
      theme: 'system',
      surfaceColor: '#eef2f8',
      accentColor: '#1a73e8',
      weekStartsOn: 1,
      defaultView: 'month',
      autostart: false,
      selectedCalendarIds: ['primary'],
      showTasks: true,
      syncIntervalMinutes: 15,
      notificationsEnabled: true,
    };
    invokeMock.mockResolvedValue(preferences);

    await client.getEvents('2026-07-20T00:00:00Z', '2026-07-21T00:00:00Z');
    expect(invokeMock).toHaveBeenLastCalledWith('get_events', {
      rangeStart: '2026-07-20T00:00:00Z',
      rangeEnd: '2026-07-21T00:00:00Z',
    });

    await client.updatePreferences(preferences);
    expect(invokeMock).toHaveBeenLastCalledWith('update_preferences', {
      input: preferences,
    });
  });
});
