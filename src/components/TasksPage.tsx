import { Check, CheckSquare2, Circle, ClipboardList } from 'lucide-react';
import type { TaskList } from '../domain';

type TasksPageProps = {
  taskLists: readonly TaskList[];
  loading: boolean;
  error?: string;
};

export function TasksPage({ taskLists, loading, error }: TasksPageProps) {
  if (loading) {
    return (
      <main className="page-surface state-panel">
        <div className="large-spinner" />
        <h2>Loading tasks</h2>
      </main>
    );
  }
  if (error) {
    return (
      <main className="page-surface state-panel">
        <ClipboardList size={34} />
        <h2>Tasks unavailable</h2>
        <p>{error}</p>
      </main>
    );
  }
  if (taskLists.every((list) => list.tasks.length === 0)) {
    return (
      <main className="page-surface state-panel">
        <CheckSquare2 size={34} />
        <h2>Nothing to do</h2>
        <p>Your Google Tasks lists are empty.</p>
      </main>
    );
  }

  return (
    <main className="page-surface tasks-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Google Tasks</span>
          <h1>Tasks</h1>
          <p>
            A read-only view of your task lists. Tasks stay separate from
            calendar events.
          </p>
        </div>
        <span className="readonly-badge">
          <Circle size={7} fill="currentColor" /> View only
        </span>
      </header>
      <div className="task-columns">
        {taskLists.map((list) => {
          const remaining = list.tasks.filter((task) => !task.completed).length;
          return (
            <section className="task-list" key={list.id}>
              <header>
                <span>
                  <ClipboardList size={17} />
                  <strong>{list.title}</strong>
                </span>
                <small>{remaining} open</small>
              </header>
              <div className="task-list__items">
                {list.tasks.map((task) => (
                  <article
                    className="task-item"
                    data-completed={task.completed}
                    key={task.id}
                  >
                    <span className="task-check">
                      {task.completed && <Check size={13} />}
                    </span>
                    <div>
                      <strong>{task.title}</strong>
                      {task.notes && <p>{task.notes}</p>}
                      {task.due && (
                        <time dateTime={task.due}>
                          Due{' '}
                          {new Date(`${task.due}T12:00:00`).toLocaleDateString(
                            undefined,
                            { month: 'short', day: 'numeric' },
                          )}
                        </time>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
