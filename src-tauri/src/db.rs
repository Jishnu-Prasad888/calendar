use std::str::FromStr;

use chrono::Utc;
use serde_json::Value;
use sqlx::{SqlitePool, sqlite::SqliteConnectOptions};

use crate::{
    error::{AppError, AppResult},
    model::{Account, Calendar, CalendarEvent, Preferences, SyncState, Task, TaskList},
};

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

impl Repository {
    pub async fn open(path: &str) -> AppResult<Self> {
        let options = SqliteConnectOptions::from_str(path)?
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePool::connect_with(options).await?;
        MIGRATOR
            .run(&pool)
            .await
            .map_err(|error| AppError::Internal(format!("database migration failed: {error}")))?;
        Ok(Self { pool })
    }

    #[cfg(test)]
    pub async fn memory() -> AppResult<Self> {
        Self::open("sqlite::memory:").await
    }

    pub async fn accounts(&self) -> AppResult<Vec<Account>> {
        Ok(
            sqlx::query_as("SELECT id, email, name, picture_url FROM accounts ORDER BY email")
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
        .bind(&account.name)
        .bind(&account.picture_url)
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
        let rows: Vec<(String, String, String, Option<String>, Option<String>, String, i64, i64)> = sqlx::query_as(
            "SELECT id,account_id,name,description,COALESCE(background_color,color),access_role,primary_calendar,selected FROM calendars WHERE deleted=0 ORDER BY primary_calendar DESC,name",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| Calendar {
                id: row.0,
                account_id: row.1,
                name: row.2,
                description: row.3,
                color: row.4,
                read_only: row.5 == "reader" || row.5 == "freeBusyReader",
                access_role: row.5,
                primary: row.6 != 0,
                selected: row.7 != 0,
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
        let changed = sqlx::query_scalar::<_, String>(
            "SELECT raw_json FROM calendars WHERE account_id=? AND id=?",
        )
        .bind(account_id)
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .is_none_or(|old| old != raw.to_string());
        sqlx::query(
            "INSERT INTO calendars(account_id,id,name,description,color,background_color,foreground_color,access_role,primary_calendar,selected,deleted,etag,raw_json,updated_at) \
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,id) DO UPDATE SET name=excluded.name,description=excluded.description,color=excluded.color,background_color=excluded.background_color,foreground_color=excluded.foreground_color,access_role=excluded.access_role,primary_calendar=excluded.primary_calendar,selected=excluded.selected,deleted=excluded.deleted,etag=excluded.etag,raw_json=excluded.raw_json,updated_at=excluded.updated_at",
        )
        .bind(account_id).bind(id).bind(raw.get("summary").and_then(Value::as_str).unwrap_or("Untitled calendar"))
        .bind(raw.get("description").and_then(Value::as_str)).bind(raw.get("colorId").and_then(Value::as_str))
        .bind(raw.get("backgroundColor").and_then(Value::as_str)).bind(raw.get("foregroundColor").and_then(Value::as_str))
        .bind(raw.get("accessRole").and_then(Value::as_str).unwrap_or("reader")).bind(bool_int(raw.get("primary")))
        .bind(bool_int(raw.get("selected").or_else(|| raw.get("primary")))).bind(bool_int(raw.get("deleted")))
        .bind(raw.get("etag").and_then(Value::as_str)).bind(raw.to_string()).bind(Utc::now().to_rfc3339())
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
        let rows: Vec<(String, String, String, String, String, i64, Option<String>, i64, String, String)> = sqlx::query_as(
            "SELECT e.id,e.calendar_id,e.title,e.start_time,e.end_time,e.all_day,e.etag,e.pending,e.raw_json,c.access_role FROM events e JOIN calendars c ON c.account_id=e.account_id AND c.id=e.calendar_id WHERE e.deleted=0 AND e.start_time < ? AND e.end_time > ? ORDER BY e.start_time",
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
        let changed = sqlx::query_scalar::<_, String>(
            "SELECT raw_json FROM events WHERE account_id=? AND calendar_id=? AND id=?",
        )
        .bind(account_id)
        .bind(calendar_id)
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .is_none_or(|old| old != raw.to_string());
        sqlx::query(
            "INSERT INTO events(account_id,calendar_id,id,title,description,location,start_time,end_time,all_day,status,etag,updated_google,raw_json,pending,deleted,updated_at) \
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,calendar_id,id) DO UPDATE SET title=excluded.title,description=excluded.description,location=excluded.location,start_time=excluded.start_time,end_time=excluded.end_time,all_day=excluded.all_day,status=excluded.status,etag=excluded.etag,updated_google=excluded.updated_google,raw_json=excluded.raw_json,pending=excluded.pending,deleted=excluded.deleted,updated_at=excluded.updated_at",
        ).bind(account_id).bind(calendar_id).bind(id).bind(raw.get("summary").and_then(Value::as_str).unwrap_or(""))
        .bind(raw.get("description").and_then(Value::as_str)).bind(raw.get("location").and_then(Value::as_str))
        .bind(&start).bind(&end).bind(bool_int(raw.get("start").and_then(|v| v.get("date")).map(|_| &Value::Bool(true))))
        .bind(raw.get("status").and_then(Value::as_str).unwrap_or("confirmed")).bind(raw.get("etag").and_then(Value::as_str))
        .bind(raw.get("updated").and_then(Value::as_str)).bind(raw.to_string()).bind(i64::from(pending))
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

    pub async fn event(
        &self,
        account_id: &str,
        calendar_id: &str,
        event_id: &str,
    ) -> AppResult<CalendarEvent> {
        let row: (String, String, String, String, String, i64, Option<String>, i64, String, String) = sqlx::query_as(
            "SELECT e.id,e.calendar_id,e.title,e.start_time,e.end_time,e.all_day,e.etag,e.pending,e.raw_json,c.access_role FROM events e JOIN calendars c ON c.account_id=e.account_id AND c.id=e.calendar_id WHERE e.account_id=? AND e.calendar_id=? AND e.id=?",
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
            let rows: Vec<(String, String, Option<String>, String, Option<String>, Option<String>)> = sqlx::query_as(
                "SELECT id,title,notes,status,due,completed FROM tasks WHERE account_id=? AND task_list_id=? ORDER BY position",
            ).bind(&account_id).bind(&id).fetch_all(&self.pool).await?;
            result.push(TaskList {
                id,
                account_id,
                title,
                read_only: true,
                tasks: rows
                    .into_iter()
                    .map(|r| Task {
                        id: r.0,
                        title: r.1,
                        notes: r.2,
                        status: r.3,
                        due: r.4,
                        completed: r.5,
                        read_only: true,
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
        sqlx::query(
            "INSERT INTO sync_state(account_id,resource_type,resource_id,sync_token,last_sync_at,status,error) VALUES(?,?,?,?,?,?,?) \
             ON CONFLICT(account_id,resource_type,resource_id) DO UPDATE SET sync_token=excluded.sync_token,last_sync_at=excluded.last_sync_at,status=excluded.status,error=excluded.error",
        ).bind(account_id).bind(kind).bind(resource_id).bind(token).bind(Utc::now().to_rfc3339()).bind(status).bind(error)
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

    pub async fn sync_states(&self) -> AppResult<Vec<SyncState>> {
        Ok(sqlx::query_as::<_, (String,String,String,Option<String>,String,Option<String>)>(
            "SELECT account_id,resource_type,resource_id,last_sync_at,status,error FROM sync_state ORDER BY account_id,resource_type,resource_id"
        ).fetch_all(&self.pool).await?.into_iter().map(|r| SyncState { account_id:r.0,resource_type:r.1,resource_id:r.2,last_sync_at:r.3,status:r.4,error:r.5 }).collect())
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

fn event_from_row(
    row: (
        String,
        String,
        String,
        String,
        String,
        i64,
        Option<String>,
        i64,
        String,
        String,
    ),
) -> AppResult<CalendarEvent> {
    let raw: Value = serde_json::from_str(&row.8)?;
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
        id: row.0,
        calendar_id: row.1,
        title: row.2,
        description: raw
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_owned),
        location: raw
            .get("location")
            .and_then(Value::as_str)
            .map(str::to_owned),
        start: row.3,
        end: row.4,
        all_day: row.5 != 0,
        color: raw
            .get("colorId")
            .and_then(Value::as_str)
            .map(str::to_owned),
        status: raw
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("confirmed")
            .to_owned(),
        read_only: row.9 == "reader" || row.9 == "freeBusyReader",
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
        etag: row.6,
        pending: row.7 != 0,
    })
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
            name: "Test".into(),
            picture_url: None,
        };
        repo.upsert_account(&account).await.unwrap();
        repo.upsert_calendar("sub", &serde_json::json!({"id":"primary","summary":"Calendar","primary":true,"accessRole":"owner"})).await.unwrap();
        repo.upsert_event("sub", "primary", &serde_json::json!({
            "id":"event1","summary":"Meeting","start":{"dateTime":"2026-07-29T09:00:00Z"},"end":{"dateTime":"2026-07-29T10:00:00Z"},"status":"confirmed"
        }), false).await.unwrap();
        assert_eq!(repo.accounts().await.unwrap().len(), 1);
        assert_eq!(repo.calendars().await.unwrap().len(), 1);
        assert_eq!(
            repo.events("2026-07-29T00:00:00Z", "2026-07-30T00:00:00Z")
                .await
                .unwrap()
                .len(),
            1
        );
        repo.remove_account("sub").await.unwrap();
        assert!(repo.calendars().await.unwrap().is_empty());
    }
}
