use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub email: String,
    pub name: String,
    pub picture_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub id: String,
    pub account_id: String,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub access_role: String,
    pub primary: bool,
    pub selected: bool,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Attendee {
    pub email: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub response_status: Option<String>,
    #[serde(default)]
    pub organizer: bool,
    #[serde(default)]
    pub self_attendee: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub method: String,
    pub minutes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub calendar_id: String,
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub color: Option<String>,
    pub status: String,
    pub read_only: bool,
    pub attendees: Vec<Attendee>,
    pub reminders: Vec<Reminder>,
    pub recurrence: Vec<String>,
    pub etag: Option<String>,
    pub pending: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInput {
    pub calendar_id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    pub start: String,
    pub end: String,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub attendees: Vec<Attendee>,
    #[serde(default)]
    pub reminders: Vec<Reminder>,
    #[serde(default)]
    pub recurrence: Vec<String>,
}

impl EventInput {
    pub fn validate(&self) -> Result<(), String> {
        if self.calendar_id.trim().is_empty() || self.title.trim().is_empty() {
            return Err("calendarId and title are required".into());
        }
        validate_range(&self.start, &self.end, self.all_day)
    }

    pub fn to_google_json(&self, id: &str) -> Value {
        let mut event = serde_json::json!({
            "id": id,
            "summary": self.title,
            "description": self.description,
            "location": self.location,
            "start": event_time(&self.start, self.all_day),
            "end": event_time(&self.end, self.all_day),
            "recurrence": self.recurrence,
        });
        if !self.attendees.is_empty() {
            event["attendees"] = serde_json::to_value(&self.attendees).unwrap_or_default();
        }
        if !self.reminders.is_empty() {
            event["reminders"] =
                serde_json::json!({"useDefault": false, "overrides": self.reminders});
        }
        event
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EventPatch {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    pub location: Option<Option<String>>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub all_day: Option<bool>,
    pub attendees: Option<Vec<Attendee>>,
    pub reminders: Option<Vec<Reminder>>,
    pub recurrence: Option<Vec<String>>,
}

impl EventPatch {
    pub fn validate(&self) -> Result<(), String> {
        if self
            .title
            .as_ref()
            .is_some_and(|title| title.trim().is_empty())
        {
            return Err("title cannot be empty".into());
        }
        if self.start.is_some() != self.end.is_some() {
            return Err("start and end must be updated together".into());
        }
        if let (Some(start), Some(end)) = (&self.start, &self.end) {
            validate_range(start, end, self.all_day.unwrap_or(false))?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub notes: Option<String>,
    pub status: String,
    pub due: Option<String>,
    pub completed: Option<String>,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskList {
    pub id: String,
    pub account_id: String,
    pub title: String,
    pub tasks: Vec<Task>,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub selected_calendar_ids: Vec<String>,
    pub show_tasks: bool,
    pub sync_interval_minutes: u32,
    pub notifications_enabled: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            selected_calendar_ids: Vec::new(),
            show_tasks: true,
            sync_interval_minutes: 15,
            notifications_enabled: true,
        }
    }
}

impl Preferences {
    pub fn validate(&self) -> Result<(), String> {
        if !(5..=1440).contains(&self.sync_interval_minutes) {
            return Err("syncIntervalMinutes must be between 5 and 1440".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub account_id: String,
    pub resource_type: String,
    pub resource_id: String,
    pub last_sync_at: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub accounts: Vec<Account>,
    pub calendars: Vec<Calendar>,
    pub preferences: Preferences,
    pub sync_state: Vec<SyncState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummary {
    pub accounts_synced: u32,
    pub calendars_changed: u32,
    pub events_changed: u32,
    pub tasks_changed: u32,
    pub mutations_applied: u32,
    pub errors: Vec<String>,
}

fn validate_range(start: &str, end: &str, all_day: bool) -> Result<(), String> {
    let valid = if all_day {
        chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d")
            .ok()
            .zip(chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d").ok())
            .is_some_and(|(start, end)| end > start)
    } else {
        chrono::DateTime::parse_from_rfc3339(start)
            .ok()
            .zip(chrono::DateTime::parse_from_rfc3339(end).ok())
            .is_some_and(|(start, end)| end > start)
    };
    valid.then_some(()).ok_or_else(|| {
        "start/end must be an increasing RFC3339 range (or YYYY-MM-DD for all-day events)".into()
    })
}

pub fn event_time(value: &str, all_day: bool) -> Value {
    if all_day {
        serde_json::json!({"date": value})
    } else {
        serde_json::json!({"dateTime": value})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_event_ranges() {
        let valid = EventInput {
            calendar_id: "primary".into(),
            title: "Planning".into(),
            description: None,
            location: None,
            start: "2026-07-29T09:00:00Z".into(),
            end: "2026-07-29T10:00:00Z".into(),
            all_day: false,
            attendees: vec![],
            reminders: vec![],
            recurrence: vec![],
        };
        assert!(valid.validate().is_ok());
        assert!(
            EventInput {
                end: valid.start.clone(),
                ..valid
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn preferences_reject_too_frequent_sync() {
        assert!(
            Preferences {
                sync_interval_minutes: 1,
                ..Default::default()
            }
            .validate()
            .is_err()
        );
    }
}
