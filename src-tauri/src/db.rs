use std::{path::Path, time::Duration};

use chrono::Utc;
use serde_json::Value;
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};

use crate::{
    error::{AppError, AppResult},
    model::{
        Account, Calendar, CalendarEvent, DetailedSyncState, EventAvailability, EventPrivacy,
        Preferences, SyncState, Task, TaskList, is_css_color,
    },
};

const DEFAULT_CALENDAR_COLOR: &str = "#1a73e8";

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

#[derive(Clone)]
pub struct Repository {
    pool: SqlitePool,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PendingMutation {
    pub id: i64,
    pub account_id: String,
    pub calendar_id: String,
    pub event_id: String,
    pub operation: String,
    pub payload_json: Option<String>,
    pub base_etag: Option<String>,
    pub attempts: i64,
}

#[derive(sqlx::FromRow)]
struct CalendarRow {
    id: String,
    account_id: String,
    name: String,
    description: Option<String>,
    color: Option<String>,
    background_color: Option<String>,
    access_role: String,
    primary_calendar: i64,
    selected: i64,
}

#[derive(sqlx::FromRow)]
struct EventRow {
    id: String,
    calendar_id: String,
    title: String,
    start_time: String,
    end_time: String,
    all_day: i64,
    etag: Option<String>,
    pending: i64,
    raw_json: String,
    access_role: String,
    calendar_color: Option<String>,
    calendar_background_color: Option<String>,
}

#[derive(sqlx::FromRow)]
struct TaskRow {
    id: String,
    title: String,
    notes: Option<String>,
    status: String,
    due: Option<String>,
    completed: Option<String>,
    raw_json: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub(crate) struct ReminderEvent {
    pub account_id: String,
    pub calendar_id: String,
    pub event_id: String,
    pub title: String,
    pub location: Option<String>,
    pub start_time: String,
    pub end_time: String,
    pub all_day: i64,
    pub event_json: String,
    pub calendar_json: String,
}

impl Repository {
    pub async fn open(path: &Path) -> AppResult<Self> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5));
        Self::connect(options, 5).await
    }

    async fn connect(options: SqliteConnectOptions, max_connections: u32) -> AppResult<Self> {
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await?;
        MIGRATOR
            .run(&pool)
            .await
            .map_err(|error| AppError::Internal(format!("database migration failed: {error}")))?;
        Ok(Self { pool })
    }

    #[cfg(test)]
    pub async fn memory() -> AppResult<Self> {
        Self::connect(
            SqliteConnectOptions::new()
                .filename(":memory:")
                .foreign_keys(true),
            1,
        )
        .await
    }

    pub async fn accounts(&self) -> AppResult<Vec<Account>> {
        Ok(
            sqlx::query_as(
                "SELECT id,email,name AS display_name,picture_url AS avatar_url,TRUE AS connected FROM accounts ORDER BY email",
            )
            .fetch_all(&self.pool)
            .await?,
        )
    }

    pub async fn upsert_account(&self, account: &Account) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO accounts(id,email,name,picture_url,created_at,updated_at) VALUES(?,?,?,?,?,?) \
             ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,picture_url=excluded.picture_url,updated_at=excluded.updated_at",
        )
        .bind(&account.id)
        .bind(&account.email)
        .bind(&account.display_name)
        .bind(&account.avatar_url)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn remove_account(&self, id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM accounts WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn calendars(&self) -> AppResult<Vec<Calendar>> {
        let rows: Vec<CalendarRow> = sqlx::query_as(
            "SELECT id,account_id,name,description,color,background_color,access_role,primary_calendar,selected FROM calendars WHERE deleted=0 ORDER BY primary_calendar DESC,name",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let background_color = valid_color(row.background_color.as_deref());
                let color = background_color
                    .clone()
                    .or_else(|| valid_color(row.color.as_deref()))
                    .unwrap_or_else(|| DEFAULT_CALENDAR_COLOR.into());
                Calendar {
                    id: row.id,
                    account_id: row.account_id,
                    name: row.name,
                    description: row.description,
                    color,
                    background_color,
                    read_only: row.access_role == "reader" || row.access_role == "freeBusyReader",
                    access_role: row.access_role,
                    primary: row.primary_calendar != 0,
                    visible: row.selected != 0,
                }
            })
            .collect())
    }

    pub async fn account_for_calendar(&self, calendar_id: &str) -> AppResult<String> {
        sqlx::query_scalar("SELECT account_id FROM calendars WHERE id=? AND deleted=0 LIMIT 1")
            .bind(calendar_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("calendar {calendar_id}")))
    }

    pub async fn upsert_calendar(&self, account_id: &str, raw: &Value) -> AppResult<bool> {
        let id = text(raw, "id")?;
        let raw_json = raw.to_string();
        let changed = sqlx::query_scalar::<_, String>(
            "SELECT raw_json FROM calendars WHERE account_id=? AND id=?",
        )
        .bind(account_id)
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .is_none_or(|old| old != raw_json);
        sqlx::query(
            "INSERT INTO calendars(account_id,id,name,description,color,background_color,foreground_color,access_role,primary_calendar,selected,deleted,etag,raw_json,updated_at) \
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,id) DO UPDATE SET name=excluded.name,description=excluded.description,color=excluded.color,background_color=excluded.background_color,foreground_color=excluded.foreground_color,access_role=excluded.access_role,primary_calendar=excluded.primary_calendar,selected=excluded.selected,deleted=excluded.deleted,etag=excluded.etag,raw_json=excluded.raw_json,updated_at=excluded.updated_at",
        )
        .bind(account_id).bind(id).bind(raw.get("summary").and_then(Value::as_str).unwrap_or("Untitled calendar"))
        .bind(raw.get("description").and_then(Value::as_str)).bind(raw.get("colorId").and_then(Value::as_str))
        .bind(raw.get("backgroundColor").and_then(Value::as_str)).bind(raw.get("foregroundColor").and_then(Value::as_str))
        .bind(raw.get("accessRole").and_then(Value::as_str).unwrap_or("reader")).bind(bool_int(raw.get("primary")))
        .bind(bool_int(raw.get("selected").or_else(|| raw.get("primary")))).bind(bool_int(raw.get("deleted")))
        .bind(raw.get("etag").and_then(Value::as_str)).bind(raw_json).bind(Utc::now().to_rfc3339())
        .execute(&self.pool).await?;
        Ok(changed)
    }

    pub async fn mark_missing_calendars_deleted(
        &self,
        account_id: &str,
        ids: &[String],
    ) -> AppResult<()> {
        sqlx::query("UPDATE calendars SET deleted=1 WHERE account_id=?")
            .bind(account_id)
            .execute(&self.pool)
            .await?;
        for id in ids {
            sqlx::query("UPDATE calendars SET deleted=0 WHERE account_id=? AND id=?")
                .bind(account_id)
                .bind(id)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    pub async fn events(&self, start: &str, end: &str) -> AppResult<Vec<CalendarEvent>> {
        let rows: Vec<EventRow> = sqlx::query_as(
            "SELECT e.id,e.calendar_id,e.title,e.start_time,e.end_time,e.all_day,e.etag,e.pending,e.raw_json,c.access_role,c.color AS calendar_color,c.background_color AS calendar_background_color FROM events e JOIN calendars c ON c.account_id=e.account_id AND c.id=e.calendar_id WHERE e.deleted=0 AND e.start_time < ? AND e.end_time > ? ORDER BY e.start_time",
        ).bind(end).bind(start).fetch_all(&self.pool).await?;
        rows.into_iter().map(event_from_row).collect()
    }

    pub async fn event_raw(
        &self,
        account_id: &str,
        calendar_id: &str,
        event_id: &str,
    ) -> AppResult<Value> {
        let raw: String = sqlx::query_scalar(
            "SELECT raw_json FROM events WHERE account_id=? AND calendar_id=? AND id=?",
        )
        .bind(account_id)
        .bind(calendar_id)
        .bind(event_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("event {event_id}")))?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub async fn upsert_event(
        &self,
        account_id: &str,
        calendar_id: &str,
        raw: &Value,
        pending: bool,
    ) -> AppResult<bool> {
        let id = text(raw, "id")?;
        let start = google_time(raw.get("start"))?;
        let end = google_time(raw.get("end"))?;
        let raw_json = raw.to_string();
        let changed = sqlx::query_scalar::<_, String>(
            "SELECT raw_json FROM events WHERE account_id=? AND calendar_id=? AND id=?",
        )
        .bind(account_id)
        .bind(calendar_id)
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .is_none_or(|old| old != raw_json);
        sqlx::query(
            "INSERT INTO events(account_id,calendar_id,id,title,description,location,start_time,end_time,all_day,status,etag,updated_google,raw_json,pending,deleted,updated_at) \
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,calendar_id,id) DO UPDATE SET title=excluded.title,description=excluded.description,location=excluded.location,start_time=excluded.start_time,end_time=excluded.end_time,all_day=excluded.all_day,status=excluded.status,etag=excluded.etag,updated_google=excluded.updated_google,raw_json=excluded.raw_json,pending=excluded.pending,deleted=excluded.deleted,updated_at=excluded.updated_at",
        ).bind(account_id).bind(calendar_id).bind(id).bind(raw.get("summary").and_then(Value::as_str).unwrap_or(""))
        .bind(raw.get("description").and_then(Value::as_str)).bind(raw.get("location").and_then(Value::as_str))
        .bind(&start).bind(&end).bind(bool_int(raw.get("start").and_then(|v| v.get("date")).map(|_| &Value::Bool(true))))
        .bind(raw.get("status").and_then(Value::as_str).unwrap_or("confirmed")).bind(raw.get("etag").and_then(Value::as_str))
        .bind(raw.get("updated").and_then(Value::as_str)).bind(raw_json).bind(i64::from(pending))
        .bind(i64::from(raw.get("status").and_then(Value::as_str) == Some("cancelled"))).bind(Utc::now().to_rfc3339())
        .execute(&self.pool).await?;
        Ok(changed)
    }

    pub async fn delete_event_local(
        &self,
        account_id: &str,
        calendar_id: &str,
        event_id: &str,
        pending: bool,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE events SET deleted=1,pending=? WHERE account_id=? AND calendar_id=? AND id=?",
        )
        .bind(i64::from(pending))
        .bind(account_id)
        .bind(calendar_id)
        .bind(event_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn mark_missing_events_deleted(
        &self,
        account_id: &str,
        calendar_id: &str,
        ids: &[String],
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE events SET deleted=1 WHERE account_id=? AND calendar_id=? AND pending=0",
        )
        .bind(account_id)
        .bind(calendar_id)
        .execute(&self.pool)
        .await?;
        for id in ids {
            sqlx::query(
                "UPDATE events SET deleted=0 WHERE account_id=? AND calendar_id=? AND id=?",
            )
            .bind(account_id)
            .bind(calendar_id)
            .bind(id)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    pub async fn event(
        &self,
        account_id: &str,
        calendar_id: &str,
        event_id: &str,
    ) -> AppResult<CalendarEvent> {
        let row: EventRow = sqlx::query_as(
            "SELECT e.id,e.calendar_id,e.title,e.start_time,e.end_time,e.all_day,e.etag,e.pending,e.raw_json,c.access_role,c.color AS calendar_color,c.background_color AS calendar_background_color FROM events e JOIN calendars c ON c.account_id=e.account_id AND c.id=e.calendar_id WHERE e.account_id=? AND e.calendar_id=? AND e.id=?",
        ).bind(account_id).bind(calendar_id).bind(event_id).fetch_optional(&self.pool).await?
        .ok_or_else(|| AppError::NotFound(format!("event {event_id}")))?;
        event_from_row(row)
    }

    pub async fn replace_task_lists(
        &self,
        account_id: &str,
        lists: &[(Value, Vec<Value>)],
    ) -> AppResult<u32> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM task_lists WHERE account_id=?")
            .bind(account_id)
            .execute(&mut *tx)
            .await?;
        let mut count = 0;
        for (list, tasks) in lists {
            let list_id = text(list, "id")?;
            sqlx::query("INSERT INTO task_lists(account_id,id,title,updated_google,raw_json) VALUES(?,?,?,?,?)")
                .bind(account_id).bind(list_id).bind(list.get("title").and_then(Value::as_str).unwrap_or("Tasks"))
                .bind(list.get("updated").and_then(Value::as_str)).bind(list.to_string()).execute(&mut *tx).await?;
            for task in tasks {
                sqlx::query("INSERT INTO tasks(account_id,task_list_id,id,title,notes,status,due,completed,position,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?)")
                    .bind(account_id).bind(list_id).bind(text(task, "id")?).bind(task.get("title").and_then(Value::as_str).unwrap_or(""))
                    .bind(task.get("notes").and_then(Value::as_str)).bind(task.get("status").and_then(Value::as_str).unwrap_or("needsAction"))
                    .bind(task.get("due").and_then(Value::as_str)).bind(task.get("completed").and_then(Value::as_str))
                    .bind(task.get("position").and_then(Value::as_str)).bind(task.to_string()).execute(&mut *tx).await?;
                count += 1;
            }
        }
        tx.commit().await?;
        Ok(count)
    }

    pub async fn task_lists(&self) -> AppResult<Vec<TaskList>> {
        let lists: Vec<(String, String, String)> =
            sqlx::query_as("SELECT account_id,id,title FROM task_lists ORDER BY title")
                .fetch_all(&self.pool)
                .await?;
        let mut result = Vec::new();
        for (account_id, id, title) in lists {
            let rows: Vec<TaskRow> = sqlx::query_as(
                "SELECT id,title,notes,status,due,completed,raw_json FROM tasks WHERE account_id=? AND task_list_id=? ORDER BY position",
            ).bind(&account_id).bind(&id).fetch_all(&self.pool).await?;
            result.push(TaskList {
                id,
                account_id,
                title,
                read_only: true,
                tasks: rows
                    .into_iter()
                    .map(|r| {
                        let raw: Value = serde_json::from_str(&r.raw_json).unwrap_or_default();
                        let updated_at = raw
                            .get("updated")
                            .and_then(Value::as_str)
                            .or(r.completed.as_deref())
                            .unwrap_or("1970-01-01T00:00:00Z")
                            .to_owned();
                        Task {
                            id: r.id,
                            title: r.title,
                            notes: r.notes,
                            completed: r.status == "completed" || r.completed.is_some(),
                            completed_at: r.completed,
                            status: r.status,
                            due: r.due,
                            updated_at,
                            read_only: true,
                        }
                    })
                    .collect(),
            });
        }
        Ok(result)
    }

    pub async fn sync_token(
        &self,
        account_id: &str,
        kind: &str,
        resource_id: &str,
    ) -> AppResult<Option<String>> {
        Ok(sqlx::query_scalar("SELECT sync_token FROM sync_state WHERE account_id=? AND resource_type=? AND resource_id=?")
            .bind(account_id).bind(kind).bind(resource_id).fetch_optional(&self.pool).await?.flatten())
    }

    pub async fn set_sync_state(
        &self,
        account_id: &str,
        kind: &str,
        resource_id: &str,
        token: Option<&str>,
        status: &str,
        error: Option<&str>,
    ) -> AppResult<()> {
        let last_sync_at = (status == "idle").then(|| Utc::now().to_rfc3339());
        sqlx::query(
            "INSERT INTO sync_state(account_id,resource_type,resource_id,sync_token,last_sync_at,status,error) VALUES(?,?,?,?,?,?,?) \
             ON CONFLICT(account_id,resource_type,resource_id) DO UPDATE SET sync_token=excluded.sync_token,last_sync_at=COALESCE(excluded.last_sync_at,sync_state.last_sync_at),status=excluded.status,error=excluded.error",
        ).bind(account_id).bind(kind).bind(resource_id).bind(token).bind(last_sync_at).bind(status).bind(error)
        .execute(&self.pool).await?;
        Ok(())
    }

    pub async fn clear_sync_token(
        &self,
        account_id: &str,
        kind: &str,
        resource_id: &str,
    ) -> AppResult<()> {
        sqlx::query("UPDATE sync_state SET sync_token=NULL WHERE account_id=? AND resource_type=? AND resource_id=?")
            .bind(account_id).bind(kind).bind(resource_id).execute(&self.pool).await?;
        Ok(())
    }

    async fn sync_states(&self) -> AppResult<Vec<DetailedSyncState>> {
        Ok(sqlx::query_as::<_, (String,String,String,Option<String>,String,Option<String>)>(
            "SELECT account_id,resource_type,resource_id,last_sync_at,status,error FROM sync_state ORDER BY account_id,resource_type,resource_id"
        ).fetch_all(&self.pool).await?.into_iter().map(|r| DetailedSyncState { account_id:r.0,resource_type:r.1,resource_id:r.2,last_sync_at:r.3,status:r.4,error:r.5 }).collect())
    }

    pub async fn sync_overview(&self) -> AppResult<SyncState> {
        Ok(SyncState::from_details(&self.sync_states().await?))
    }

    pub async fn preferences(&self) -> AppResult<Preferences> {
        let raw: Option<String> =
            sqlx::query_scalar("SELECT json FROM preferences WHERE singleton=1")
                .fetch_optional(&self.pool)
                .await?;
        raw.map(|value| serde_json::from_str(&value).map_err(AppError::from))
            .unwrap_or(Ok(Preferences::default()))
    }

    pub async fn set_preferences(&self, value: &Preferences) -> AppResult<()> {
        sqlx::query("INSERT INTO preferences(singleton,json) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET json=excluded.json")
            .bind(serde_json::to_string(value)?).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn reminder_events(&self) -> AppResult<Vec<ReminderEvent>> {
        Ok(sqlx::query_as(
            "SELECT e.account_id,e.calendar_id,e.id AS event_id,e.title,e.location,e.start_time,e.end_time,e.all_day,e.raw_json AS event_json,c.raw_json AS calendar_json FROM events e JOIN calendars c ON c.account_id=e.account_id AND c.id=e.calendar_id WHERE e.deleted=0 AND c.deleted=0 AND date(substr(e.start_time,1,10)) BETWEEN date('now','-1 day') AND date('now','+29 days')",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn claim_reminder(
        &self,
        event: &ReminderEvent,
        reminder_time: &str,
        delivered_at: &str,
    ) -> AppResult<bool> {
        let result = sqlx::query(
            "INSERT OR IGNORE INTO delivered_reminders(account_id,calendar_id,event_id,reminder_time,delivered_at) VALUES(?,?,?,?,?)",
        )
        .bind(&event.account_id)
        .bind(&event.calendar_id)
        .bind(&event.event_id)
        .bind(reminder_time)
        .bind(delivered_at)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn release_reminder(
        &self,
        event: &ReminderEvent,
        reminder_time: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "DELETE FROM delivered_reminders WHERE account_id=? AND calendar_id=? AND event_id=? AND reminder_time=?",
        )
        .bind(&event.account_id)
        .bind(&event.calendar_id)
        .bind(&event.event_id)
        .bind(reminder_time)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn prune_delivered_reminders(&self, before: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM delivered_reminders WHERE delivered_at < ?")
            .bind(before)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn enqueue_mutation(
        &self,
        account_id: &str,
        calendar_id: &str,
        event_id: &str,
        operation: &str,
        payload: Option<&Value>,
        etag: Option<&str>,
    ) -> AppResult<()> {
        sqlx::query("INSERT INTO pending_mutations(account_id,calendar_id,event_id,operation,payload_json,base_etag,next_attempt_at,created_at) VALUES(?,?,?,?,?,?,?,?)")
            .bind(account_id).bind(calendar_id).bind(event_id).bind(operation).bind(payload.map(Value::to_string)).bind(etag)
            .bind(Utc::now().to_rfc3339()).bind(Utc::now().to_rfc3339()).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn due_mutations(&self) -> AppResult<Vec<PendingMutation>> {
        Ok(sqlx::query_as("SELECT id,account_id,calendar_id,event_id,operation,payload_json,base_etag,attempts FROM pending_mutations WHERE next_attempt_at<=? ORDER BY id LIMIT 100")
            .bind(Utc::now().to_rfc3339()).fetch_all(&self.pool).await?)
    }

    pub async fn mutation_succeeded(&self, id: i64) -> AppResult<()> {
        sqlx::query("DELETE FROM pending_mutations WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn mutation_failed(
        &self,
        id: i64,
        attempts: i64,
        error: &str,
        transient: bool,
    ) -> AppResult<()> {
        let delay = if transient {
            2_i64.pow(attempts.clamp(0, 8) as u32)
        } else {
            86_400
        };
        let next = Utc::now() + chrono::Duration::seconds(delay);
        sqlx::query(
            "UPDATE pending_mutations SET attempts=?,next_attempt_at=?,last_error=? WHERE id=?",
        )
        .bind(attempts + 1)
        .bind(next.to_rfc3339())
        .bind(error)
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

fn text<'a>(value: &'a Value, key: &str) -> AppResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Validation(format!("Google resource missing {key}")))
}

fn google_time(value: Option<&Value>) -> AppResult<String> {
    value
        .and_then(|v| v.get("dateTime").or_else(|| v.get("date")))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| AppError::Validation("event missing start/end".into()))
}

fn bool_int(value: Option<&Value>) -> i64 {
    i64::from(value.and_then(Value::as_bool).unwrap_or(false))
}

fn event_from_row(row: EventRow) -> AppResult<CalendarEvent> {
    let raw: Value = serde_json::from_str(&row.raw_json)?;
    let attendees = serde_json::from_value(
        raw.get("attendees")
            .cloned()
            .unwrap_or_else(|| Value::Array(vec![])),
    )
    .unwrap_or_default();
    let reminders = raw
        .get("reminders")
        .and_then(|r| r.get("overrides"))
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    Ok(CalendarEvent {
        id: row.id,
        calendar_id: row.calendar_id,
        title: row.title,
        description: raw
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_owned),
        location: raw
            .get("location")
            .and_then(Value::as_str)
            .map(str::to_owned),
        start: row.start_time,
        end: row.end_time,
        all_day: row.all_day != 0,
        color: ["color", "backgroundColor", "colorId"]
            .into_iter()
            .find_map(|key| valid_color(raw.get(key).and_then(Value::as_str)))
            .or_else(|| valid_color(row.calendar_background_color.as_deref()))
            .or_else(|| valid_color(row.calendar_color.as_deref()))
            .or_else(|| Some(DEFAULT_CALENDAR_COLOR.into())),
        status: raw
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("confirmed")
            .to_owned(),
        read_only: row.access_role == "reader"
            || row.access_role == "freeBusyReader"
            || raw.get("locked").and_then(Value::as_bool) == Some(true),
        attendees,
        reminders,
        recurrence: raw
            .get("recurrence")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
        privacy: match raw.get("visibility").and_then(Value::as_str) {
            Some("public") => EventPrivacy::Public,
            Some("private") => EventPrivacy::Private,
            _ => EventPrivacy::Default,
        },
        availability: if raw.get("transparency").and_then(Value::as_str) == Some("transparent") {
            EventAvailability::Free
        } else {
            EventAvailability::Busy
        },
        etag: row.etag,
        pending: row.pending != 0,
    })
}

fn valid_color(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| is_css_color(value))
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn migrations_and_repository_round_trip() {
        let repo = Repository::memory().await.unwrap();
        let account = Account {
            id: "sub".into(),
            email: "test@example.com".into(),
            display_name: "Test".into(),
            avatar_url: None,
            connected: true,
        };
        repo.upsert_account(&account).await.unwrap();
        repo.upsert_calendar("sub", &serde_json::json!({"id":"primary","summary":"Calendar","primary":true,"accessRole":"owner","backgroundColor":"#123456","colorId":"11"})).await.unwrap();
        repo.upsert_event("sub", "primary", &serde_json::json!({
            "id":"event1","summary":"Meeting","colorId":"10","visibility":"private","transparency":"transparent","start":{"dateTime":"2026-07-29T09:00:00Z"},"end":{"dateTime":"2026-07-29T10:00:00Z"},"status":"confirmed"
        }), false).await.unwrap();
        assert_eq!(repo.accounts().await.unwrap().len(), 1);
        let calendars = repo.calendars().await.unwrap();
        assert_eq!(calendars[0].color, "#123456");
        assert_eq!(calendars[0].background_color.as_deref(), Some("#123456"));
        assert!(calendars[0].visible);
        let events = repo
            .events("2026-07-29T00:00:00Z", "2026-07-30T00:00:00Z")
            .await
            .unwrap();
        assert_eq!(events[0].color.as_deref(), Some("#123456"));
        assert_eq!(events[0].privacy, EventPrivacy::Private);
        assert_eq!(events[0].availability, EventAvailability::Free);
        repo.replace_task_lists(
            "sub",
            &[(
                serde_json::json!({"id":"list","title":"Tasks","updated":"2026-07-29T09:00:00Z"}),
                vec![serde_json::json!({
                    "id":"task","title":"Review","status":"completed","completed":"2026-07-29T10:00:00Z","updated":"2026-07-29T11:00:00Z"
                })],
            )],
        )
        .await
        .unwrap();
        let task_lists = repo.task_lists().await.unwrap();
        assert!(task_lists[0].tasks[0].completed);
        assert_eq!(task_lists[0].tasks[0].updated_at, "2026-07-29T11:00:00Z");
        assert_eq!(
            task_lists[0].tasks[0].completed_at.as_deref(),
            Some("2026-07-29T10:00:00Z")
        );
        repo.remove_account("sub").await.unwrap();
        assert!(repo.calendars().await.unwrap().is_empty());
    }
}
