use serde_json::{Map, Value};
use tauri::{AppHandle, State};

use crate::{
    AppState,
    error::{AppError, AppResult},
    model::{
        Account, AppSnapshot, CalendarEvent, EventInput, EventPatch, Preferences, SyncState,
        SyncStatus, TaskList, event_time,
    },
};

#[tauri::command]
pub async fn bootstrap(state: State<'_, AppState>) -> AppResult<AppSnapshot> {
    Ok(AppSnapshot {
        accounts: state.repo.accounts().await?,
        calendars: state.repo.calendars().await?,
        preferences: state.repo.preferences().await?,
        sync_state: state.repo.sync_overview().await?,
    })
}

#[tauri::command]
pub async fn get_events(
    range_start: String,
    range_end: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<CalendarEvent>> {
    let start = chrono::DateTime::parse_from_rfc3339(&range_start)
        .map_err(|_| AppError::Validation("rangeStart must be RFC3339".into()))?;
    let end = chrono::DateTime::parse_from_rfc3339(&range_end)
        .map_err(|_| AppError::Validation("rangeEnd must be RFC3339".into()))?;
    if end <= start {
        return Err(AppError::Validation(
            "rangeEnd must be after rangeStart".into(),
        ));
    }
    state.repo.events(&range_start, &range_end).await
}

#[tauri::command]
pub async fn get_task_lists(state: State<'_, AppState>) -> AppResult<Vec<TaskList>> {
    state.repo.task_lists().await
}

#[tauri::command]
pub async fn start_google_auth(app: AppHandle, state: State<'_, AppState>) -> AppResult<Account> {
    let account = state.auth.authorize(&app).await?;
    state.repo.upsert_account(&account).await?;
    let _ = state.sync.sync_all().await?;
    Ok(account)
}

#[tauri::command]
pub async fn remove_account(account_id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.auth.revoke(&account_id).await?;
    state.repo.remove_account(&account_id).await
}

#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> AppResult<SyncState> {
    state.auth.ensure_configured()?;
    let summary = state.sync.sync_all().await?;
    let mut overview = state.repo.sync_overview().await?;
    if !summary.errors.is_empty() && overview.status != SyncStatus::Error {
        overview.status = SyncStatus::Error;
        overview.message = Some(summary.errors.join("; "));
    }
    Ok(overview)
}

#[tauri::command]
pub async fn create_event(
    input: EventInput,
    state: State<'_, AppState>,
) -> AppResult<CalendarEvent> {
    input.validate().map_err(AppError::Validation)?;
    ensure_writable(&state, &input.calendar_id).await?;
    let account_id = state.repo.account_for_calendar(&input.calendar_id).await?;
    // Google event IDs accept lowercase base32hex characters; UUID simple format is a valid subset.
    let event_id = uuid::Uuid::new_v4().simple().to_string();
    let event = input.to_google_json(&event_id);
    state
        .repo
        .upsert_event(&account_id, &input.calendar_id, &event, true)
        .await?;
    state
        .repo
        .enqueue_mutation(
            &account_id,
            &input.calendar_id,
            &event_id,
            "create",
            Some(&event),
            None,
        )
        .await?;
    state
        .repo
        .event(&account_id, &input.calendar_id, &event_id)
        .await
}

#[tauri::command]
pub async fn update_event(
    event_id: String,
    calendar_id: String,
    patch: EventPatch,
    state: State<'_, AppState>,
) -> AppResult<CalendarEvent> {
    patch.validate().map_err(AppError::Validation)?;
    ensure_writable(&state, &calendar_id).await?;
    let account_id = state.repo.account_for_calendar(&calendar_id).await?;
    let mut raw = state
        .repo
        .event_raw(&account_id, &calendar_id, &event_id)
        .await?;
    let etag = raw.get("etag").and_then(Value::as_str).map(str::to_owned);
    let google_patch = apply_event_patch(&mut raw, &patch)?;
    state
        .repo
        .upsert_event(&account_id, &calendar_id, &raw, true)
        .await?;
    state
        .repo
        .enqueue_mutation(
            &account_id,
            &calendar_id,
            &event_id,
            "update",
            Some(&google_patch),
            etag.as_deref(),
        )
        .await?;
    state.repo.event(&account_id, &calendar_id, &event_id).await
}

#[tauri::command]
pub async fn delete_event(
    event_id: String,
    calendar_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    ensure_writable(&state, &calendar_id).await?;
    let account_id = state.repo.account_for_calendar(&calendar_id).await?;
    let raw = state
        .repo
        .event_raw(&account_id, &calendar_id, &event_id)
        .await?;
    let etag = raw.get("etag").and_then(Value::as_str);
    state
        .repo
        .delete_event_local(&account_id, &calendar_id, &event_id, true)
        .await?;
    state
        .repo
        .enqueue_mutation(&account_id, &calendar_id, &event_id, "delete", None, etag)
        .await
}

#[tauri::command]
pub async fn respond_to_event(
    event_id: String,
    calendar_id: String,
    response: String,
    state: State<'_, AppState>,
) -> AppResult<CalendarEvent> {
    if !matches!(
        response.as_str(),
        "accepted" | "declined" | "tentative" | "needsAction"
    ) {
        return Err(AppError::Validation(
            "response must be accepted, declined, tentative, or needsAction".into(),
        ));
    }
    ensure_writable(&state, &calendar_id).await?;
    let account_id = state.repo.account_for_calendar(&calendar_id).await?;
    let mut raw = state
        .repo
        .event_raw(&account_id, &calendar_id, &event_id)
        .await?;
    let etag = raw.get("etag").and_then(Value::as_str).map(str::to_owned);
    let attendees = raw
        .get_mut("attendees")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| AppError::Validation("event has no attendees".into()))?;
    let attendee = attendees
        .iter_mut()
        .find(|attendee| attendee.get("self").and_then(Value::as_bool) == Some(true))
        .ok_or_else(|| AppError::Validation("event has no attendee for this account".into()))?;
    attendee["responseStatus"] = Value::String(response);
    let google_patch = serde_json::json!({"attendees": attendees});
    state
        .repo
        .upsert_event(&account_id, &calendar_id, &raw, true)
        .await?;
    state
        .repo
        .enqueue_mutation(
            &account_id,
            &calendar_id,
            &event_id,
            "rsvp",
            Some(&google_patch),
            etag.as_deref(),
        )
        .await?;
    state.repo.event(&account_id, &calendar_id, &event_id).await
}

#[tauri::command]
pub async fn update_preferences(
    input: Preferences,
    state: State<'_, AppState>,
) -> AppResult<Preferences> {
    input.validate().map_err(AppError::Validation)?;
    state.repo.set_preferences(&input).await?;
    Ok(input)
}

async fn ensure_writable(state: &AppState, calendar_id: &str) -> AppResult<()> {
    let calendar = state
        .repo
        .calendars()
        .await?
        .into_iter()
        .find(|calendar| calendar.id == calendar_id)
        .ok_or_else(|| AppError::NotFound(format!("calendar {calendar_id}")))?;
    if calendar.read_only {
        Err(AppError::Validation("calendar is read-only".into()))
    } else {
        Ok(())
    }
}

fn apply_event_patch(raw: &mut Value, patch: &EventPatch) -> AppResult<Value> {
    let object = raw
        .as_object_mut()
        .ok_or_else(|| AppError::Validation("stored event is not an object".into()))?;
    let mut changed = Map::new();
    if let Some(title) = &patch.title {
        set(
            &mut changed,
            object,
            "summary",
            Value::String(title.clone()),
        );
    }
    apply_nullable(&mut changed, object, "description", &patch.description);
    apply_nullable(&mut changed, object, "location", &patch.location);
    if let (Some(start), Some(end)) = (&patch.start, &patch.end) {
        let all_day = patch.all_day.unwrap_or_else(|| {
            object
                .get("start")
                .and_then(|start| start.get("date"))
                .is_some()
        });
        set(&mut changed, object, "start", event_time(start, all_day));
        set(&mut changed, object, "end", event_time(end, all_day));
    }
    if let Some(attendees) = &patch.attendees {
        let value = attendee_values(attendees);
        set(&mut changed, object, "attendees", value);
    }
    if let Some(reminders) = &patch.reminders {
        let value = serde_json::json!({"useDefault": false, "overrides": reminders});
        set(&mut changed, object, "reminders", value);
    }
    if let Some(recurrence) = &patch.recurrence {
        let value = serde_json::to_value(recurrence)?;
        set(&mut changed, object, "recurrence", value);
    }
    if let Some(privacy) = patch.privacy {
        set(
            &mut changed,
            object,
            "visibility",
            serde_json::to_value(privacy)?,
        );
    }
    if let Some(availability) = patch.availability {
        set(
            &mut changed,
            object,
            "transparency",
            Value::String(availability.google_transparency().into()),
        );
    }
    if changed.is_empty() {
        return Err(AppError::Validation("event patch is empty".into()));
    }
    Ok(Value::Object(changed))
}

fn apply_nullable(
    changed: &mut Map<String, Value>,
    object: &mut Map<String, Value>,
    key: &str,
    field: &Option<Option<String>>,
) {
    if let Some(value) = field {
        let value = value.clone().map(Value::String).unwrap_or(Value::Null);
        set(changed, object, key, value);
    }
}

fn set(changed: &mut Map<String, Value>, object: &mut Map<String, Value>, key: &str, value: Value) {
    object.insert(key.to_owned(), value.clone());
    changed.insert(key.to_owned(), value);
}

fn attendee_values(attendees: &[String]) -> Value {
    Value::Array(
        attendees
            .iter()
            .map(|email| serde_json::json!({"email": email}))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patch_preserves_unknown_fields_and_can_clear_values() {
        let mut raw = serde_json::json!({
            "id": "event", "summary": "Old", "description": "remove", "unknown": {"kept": true},
            "start": {"dateTime": "2026-07-29T09:00:00Z"}, "end": {"dateTime": "2026-07-29T10:00:00Z"}
        });
        let patch = EventPatch {
            title: Some("New".into()),
            description: Some(None),
            privacy: Some(crate::model::EventPrivacy::Private),
            availability: Some(crate::model::EventAvailability::Free),
            ..Default::default()
        };
        let google_patch = apply_event_patch(&mut raw, &patch).unwrap();
        assert_eq!(raw["unknown"]["kept"], true);
        assert!(raw["description"].is_null());
        assert_eq!(raw["visibility"], "private");
        assert_eq!(raw["transparency"], "transparent");
        assert!(google_patch.get("unknown").is_none());
    }
}
