import { describe, expect, it } from 'vitest';
import { createDemoClient, createDemoStore } from './ipc';

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

    const preferences = await client.updatePreferences({
      theme: 'dark',
      weekStartsOn: 0,
    });
    expect(preferences).toMatchObject({ theme: 'dark', weekStartsOn: 0 });
  });
});
