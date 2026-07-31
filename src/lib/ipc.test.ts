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

  it('creates, updates, and deletes tasks in memory', async () => {
    const client = createDemoClient(
      createDemoStore(new Date('2026-07-20T12:00:00Z')),
    );
    const created = await client.createTask({
      taskListId: 'tasks-work',
      title: 'Prepare agenda',
      notes: 'Send before lunch',
      due: '2026-07-21',
      completed: false,
    });
    expect(created).toMatchObject({
      title: 'Prepare agenda',
      completed: false,
    });

    const updated = await client.updateTask(created.id, {
      taskListId: 'tasks-work',
      title: 'Prepare final agenda',
      completed: true,
    });
    expect(updated).toMatchObject({
      title: 'Prepare final agenda',
      completed: true,
    });

    await client.deleteTask(created.id, 'tasks-work');
    expect(
      (await client.getTaskLists())
        .find((list) => list.id === 'tasks-work')
        ?.tasks.some((task) => task.id === created.id),
    ).toBe(false);
  });

  it('creates, updates, and deletes local notes', async () => {
    const client = createDemoClient(
      createDemoStore(new Date('2026-07-20T12:00:00Z')),
    );
    const input = {
      kind: 'text' as const,
      title: 'Idea',
      body: 'Build it',
      items: [],
      color: '#fff8b8',
      pinned: false,
      archived: false,
    };
    const created = await client.createKeepNote(input);
    expect(created.title).toBe('Idea');

    const updated = await client.updateKeepNote(created.id, {
      ...input,
      pinned: true,
    });
    expect(updated.pinned).toBe(true);

    await client.deleteKeepNote(created.id);
    expect(await client.getKeepNotes()).not.toContainEqual(
      expect.objectContaining({ id: created.id }),
    );
  });

  it('uses camelCase Tauri arguments and sends complete preferences', async () => {
    const client = createTauriClient();
    const preferences: Preferences = {
      googleClientId: 'client.apps.googleusercontent.com',
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

    const taskInput = {
      taskListId: 'tasks-work',
      title: 'Prepare agenda',
      completed: false,
    };
    await client.updateTask('task-1', taskInput);
    expect(invokeMock).toHaveBeenLastCalledWith('update_task', {
      taskId: 'task-1',
      input: taskInput,
    });
    await client.deleteTask('task-1', 'tasks-work');
    expect(invokeMock).toHaveBeenLastCalledWith('delete_task', {
      taskId: 'task-1',
      taskListId: 'tasks-work',
    });

    await client.updateKeepNote('note-1', {
      kind: 'text',
      title: 'Updated',
      body: '',
      items: [],
      color: '#fff8b8',
      pinned: false,
      archived: false,
    });
    expect(invokeMock).toHaveBeenLastCalledWith('update_keep_note', {
      noteId: 'note-1',
      input: {
        kind: 'text',
        title: 'Updated',
        body: '',
        items: [],
        color: '#fff8b8',
        pinned: false,
        archived: false,
      },
    });

    await client.updatePreferences(preferences);
    expect(invokeMock).toHaveBeenLastCalledWith('update_preferences', {
      input: preferences,
    });

    await client.updateGoogleOAuthConfiguration(
      'client.apps.googleusercontent.com',
      'secret',
    );
    expect(invokeMock).toHaveBeenLastCalledWith(
      'update_google_oauth_configuration',
      {
        clientId: 'client.apps.googleusercontent.com',
        clientSecret: 'secret',
      },
    );
  });
});
