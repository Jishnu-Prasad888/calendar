use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub email: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub id: String,
    pub account_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    pub access_role: String,
    pub primary: bool,
    pub visible: bool,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Attendee {
    pub email: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default = "needs_action")]
    pub response_status: String,
    #[serde(default)]
    pub organizer: bool,
    #[serde(default, rename = "self")]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub status: String,
    pub read_only: bool,
    pub attendees: Vec<Attendee>,
    pub reminders: Vec<Reminder>,
    pub recurrence: Vec<String>,
    pub privacy: EventPrivacy,
    pub availability: EventAvailability,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    pub pending: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EventPrivacy {
    #[default]
    Default,
    Public,
    Private,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EventAvailability {
    #[default]
    Busy,
    Free,
}

impl EventAvailability {
    pub fn google_transparency(self) -> &'static str {
        match self {
            Self::Busy => "opaque",
            Self::Free => "transparent",
        }
    }
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
    pub attendees: Vec<String>,
    #[serde(default)]
    pub reminders: Vec<Reminder>,
    #[serde(default)]
    pub recurrence: Vec<String>,
    #[serde(default)]
    pub privacy: EventPrivacy,
    #[serde(default)]
    pub availability: EventAvailability,
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
            "visibility": self.privacy,
            "transparency": self.availability.google_transparency(),
        });
        if !self.attendees.is_empty() {
            event["attendees"] = Value::Array(
                self.attendees
                    .iter()
                    .map(|email| serde_json::json!({"email": email}))
                    .collect(),
            );
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
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub description: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub location: Option<Option<String>>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub all_day: Option<bool>,
    pub attendees: Option<Vec<String>>,
    pub reminders: Option<Vec<Reminder>>,
    pub recurrence: Option<Vec<String>>,
    pub privacy: Option<EventPrivacy>,
    pub availability: Option<EventAvailability>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due: Option<String>,
    pub completed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub updated_at: String,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum KeepNoteKind {
    Text,
    Checklist,
}

impl KeepNoteKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Checklist => "checklist",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KeepNoteItem {
    pub id: String,
    pub text: String,
    pub checked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KeepNoteItemInput {
    pub id: String,
    pub text: String,
    pub checked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeepNote {
    pub id: String,
    pub kind: KeepNoteKind,
    pub title: String,
    pub body: String,
    pub items: Vec<KeepNoteItem>,
    pub color: String,
    pub pinned: bool,
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeepNoteInput {
    pub kind: KeepNoteKind,
    pub title: String,
    pub body: String,
    pub items: Vec<KeepNoteItemInput>,
    pub color: String,
    pub pinned: bool,
    pub archived: bool,
}

impl KeepNoteInput {
    pub fn validate(&self) -> Result<(), String> {
        if self.title.chars().count() > 500 {
            return Err("title must be at most 500 characters".into());
        }
        if self.body.chars().count() > 100_000 {
            return Err("body must be at most 100000 characters".into());
        }
        if self.color.len() > 64 || !is_css_color(&self.color) {
            return Err("color must be a valid CSS color of at most 64 bytes".into());
        }
        match self.kind {
            KeepNoteKind::Text => {
                if !self.items.is_empty() {
                    return Err("text notes cannot have checklist items".into());
                }
                if self.title.trim().is_empty() && self.body.trim().is_empty() {
                    return Err("title and body cannot both be blank".into());
                }
            }
            KeepNoteKind::Checklist => {
                if !self.body.trim().is_empty() {
                    return Err("checklist note body must be blank".into());
                }
                if self.items.len() > 500 {
                    return Err("checklist notes can have at most 500 items".into());
                }
                if self.title.trim().is_empty() && self.items.is_empty() {
                    return Err("checklist notes must have a title or at least one item".into());
                }

                let mut ids = std::collections::HashSet::with_capacity(self.items.len());
                for item in &self.items {
                    let id = uuid::Uuid::parse_str(&item.id)
                        .map_err(|_| "checklist item id must be a valid UUID")?;
                    if !ids.insert(id) {
                        return Err("checklist item ids must be unique".into());
                    }
                    if item.text.trim().is_empty() {
                        return Err("checklist item text cannot be blank".into());
                    }
                    if item.text.chars().count() > 10_000 {
                        return Err("checklist item text must be at most 10000 characters".into());
                    }
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub google_client_id: String,
    pub theme: ThemeMode,
    pub surface_color: String,
    pub accent_color: String,
    pub week_starts_on: u8,
    pub default_view: CalendarView,
    pub autostart: bool,
    pub selected_calendar_ids: Vec<String>,
    pub show_tasks: bool,
    pub sync_interval_minutes: u32,
    pub notifications_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthConfiguration {
    pub client_id: String,
    pub client_secret_configured: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Light,
    Dark,
    #[default]
    System,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CalendarView {
    #[default]
    Month,
    Week,
    Day,
    Year,
    Schedule,
    MultiDay,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            google_client_id: option_env!("GOOGLE_CLIENT_ID")
                .unwrap_or_default()
                .trim()
                .to_owned(),
            theme: ThemeMode::System,
            surface_color: "#eef2f8".into(),
            accent_color: "#1a73e8".into(),
            week_starts_on: 1,
            default_view: CalendarView::Month,
            autostart: false,
            selected_calendar_ids: Vec::new(),
            show_tasks: true,
            sync_interval_minutes: 15,
            notifications_enabled: true,
        }
    }
}

impl Preferences {
    pub fn validate(&self) -> Result<(), String> {
        let client_id = self.google_client_id.trim();
        if !client_id.is_empty() && !client_id.ends_with(".apps.googleusercontent.com") {
            return Err("googleClientId must be a Google OAuth client ID".into());
        }
        if !matches!(self.week_starts_on, 0 | 1 | 6) {
            return Err("weekStartsOn must be 0, 1, or 6".into());
        }
        if !is_css_color(&self.surface_color) || !is_css_color(&self.accent_color) {
            return Err("surfaceColor and accentColor must be valid CSS colors".into());
        }
        if !(1..=1440).contains(&self.sync_interval_minutes) {
            return Err("syncIntervalMinutes must be between 1 and 1440".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct DetailedSyncState {
    #[expect(dead_code, reason = "retained as the internal sync record identity")]
    pub account_id: String,
    #[expect(dead_code, reason = "retained as the internal sync record identity")]
    pub resource_type: String,
    #[expect(dead_code, reason = "retained as the internal sync record identity")]
    pub resource_id: String,
    pub last_sync_at: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub status: SyncStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_synced_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SyncStatus {
    #[default]
    Idle,
    Syncing,
    Offline,
    Error,
}

impl SyncState {
    pub fn from_details(details: &[DetailedSyncState]) -> Self {
        let status = if details.iter().any(|state| state.status == "syncing") {
            SyncStatus::Syncing
        } else if details.iter().any(|state| state.status == "error") {
            SyncStatus::Error
        } else if details.iter().any(|state| state.status == "offline") {
            SyncStatus::Offline
        } else {
            SyncStatus::Idle
        };
        let last_synced_at = details
            .iter()
            .filter_map(|state| {
                state
                    .last_sync_at
                    .as_ref()
                    .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                    .map(|parsed| (parsed, state.last_sync_at.clone()))
            })
            .max_by_key(|(parsed, _)| *parsed)
            .and_then(|(_, value)| value);
        let errors: Vec<_> = details
            .iter()
            .filter_map(|state| state.error.as_deref())
            .collect();
        Self {
            status,
            last_synced_at,
            message: (!errors.is_empty()).then(|| errors.join("; ")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub accounts: Vec<Account>,
    pub calendars: Vec<Calendar>,
    pub preferences: Preferences,
    pub oauth_configuration: OAuthConfiguration,
    pub sync_state: SyncState,
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

pub fn is_css_color(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && !value.chars().all(|character| character.is_ascii_digit())
        && csscolorparser::parse(value).is_ok()
}

fn needs_action() -> String {
    "needsAction".into()
}

fn deserialize_nullable<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
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
            privacy: EventPrivacy::Default,
            availability: EventAvailability::Busy,
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
    fn preferences_validate_sync_interval_bounds() {
        assert!(
            Preferences {
                google_client_id: String::new(),
                sync_interval_minutes: 1,
                ..Default::default()
            }
            .validate()
            .is_ok()
        );
        assert!(
            Preferences {
                google_client_id: String::new(),
                sync_interval_minutes: 0,
                ..Default::default()
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn preferences_validate_google_client_ids() {
        assert!(Preferences::default().validate().is_ok());
        assert!(
            Preferences {
                google_client_id: "not-a-google-client".into(),
                ..Default::default()
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn keep_note_input_validates_content_color_and_lengths() {
        let valid = KeepNoteInput {
            kind: KeepNoteKind::Text,
            title: "Shopping".into(),
            body: "Milk".into(),
            items: Vec::new(),
            color: "#fbbc04".into(),
            pinned: false,
            archived: false,
        };
        assert!(valid.validate().is_ok());
        assert!(
            KeepNoteInput {
                title: "  ".into(),
                body: "\n".into(),
                ..valid.clone()
            }
            .validate()
            .is_err()
        );
        assert!(
            KeepNoteInput {
                color: "not a color".into(),
                ..valid.clone()
            }
            .validate()
            .is_err()
        );
        assert!(
            KeepNoteInput {
                title: "x".repeat(501),
                ..valid
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn keep_note_input_validates_checklist_shape_and_items() {
        let item = KeepNoteItemInput {
            id: "00000000-0000-4000-8000-000000000001".into(),
            text: "Milk".into(),
            checked: false,
        };
        let valid = KeepNoteInput {
            kind: KeepNoteKind::Checklist,
            title: String::new(),
            body: String::new(),
            items: vec![item.clone()],
            color: "yellow".into(),
            pinned: false,
            archived: false,
        };
        assert!(valid.validate().is_ok());
        assert!(
            KeepNoteInput {
                title: "List".into(),
                items: Vec::new(),
                ..valid.clone()
            }
            .validate()
            .is_ok()
        );
        assert!(
            KeepNoteInput {
                title: String::new(),
                items: Vec::new(),
                ..valid.clone()
            }
            .validate()
            .is_err()
        );
        assert!(
            KeepNoteInput {
                body: "checklist body".into(),
                ..valid.clone()
            }
            .validate()
            .is_err()
        );
        assert!(
            KeepNoteInput {
                items: vec![KeepNoteItemInput {
                    text: "  ".into(),
                    ..item.clone()
                }],
                ..valid.clone()
            }
            .validate()
            .is_err()
        );
        assert!(
            KeepNoteInput {
                items: vec![KeepNoteItemInput {
                    id: String::new(),
                    ..item.clone()
                }],
                ..valid.clone()
            }
            .validate()
            .is_err()
        );
        assert!(
            KeepNoteInput {
                items: vec![item.clone(), item.clone()],
                ..valid.clone()
            }
            .validate()
            .is_err()
        );
        assert!(
            KeepNoteInput {
                items: vec![KeepNoteItemInput {
                    text: "x".repeat(10_001),
                    ..item.clone()
                }],
                ..valid.clone()
            }
            .validate()
            .is_err()
        );
        assert!(
            KeepNoteInput {
                kind: KeepNoteKind::Text,
                title: "Text".into(),
                body: String::new(),
                items: vec![item],
                ..valid
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn keep_note_input_rejects_too_many_checklist_items() {
        let items = (0..501)
            .map(|index| KeepNoteItemInput {
                id: uuid::Uuid::from_u128(index + 1).to_string(),
                text: "Item".into(),
                checked: false,
            })
            .collect();
        assert!(
            KeepNoteInput {
                kind: KeepNoteKind::Checklist,
                title: "Long list".into(),
                body: String::new(),
                items,
                color: "white".into(),
                pinned: false,
                archived: false,
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn frontend_contract_serializes_expected_shapes() {
        let account = serde_json::to_value(Account {
            id: "sub".into(),
            email: "person@example.com".into(),
            display_name: "Person".into(),
            avatar_url: None,
            connected: true,
        })
        .unwrap();
        assert_eq!(
            account,
            serde_json::json!({
                "id": "sub", "email": "person@example.com", "displayName": "Person", "connected": true
            })
        );

        let calendar = serde_json::to_value(Calendar {
            id: "primary".into(),
            account_id: "sub".into(),
            name: "Calendar".into(),
            description: None,
            color: "#123456".into(),
            background_color: Some("#123456".into()),
            access_role: "owner".into(),
            primary: true,
            visible: true,
            read_only: false,
        })
        .unwrap();
        assert_eq!(calendar["color"], "#123456");
        assert_eq!(calendar["backgroundColor"], "#123456");
        assert_eq!(calendar["visible"], true);
        assert!(calendar.get("selected").is_none());

        let attendee: Attendee = serde_json::from_value(serde_json::json!({
            "email": "person@example.com", "self": true, "organizer": true
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(attendee).unwrap(),
            serde_json::json!({
                "email": "person@example.com", "responseStatus": "needsAction", "organizer": true, "self": true
            })
        );

        let preferences: Preferences = serde_json::from_value(serde_json::json!({
            "syncIntervalMinutes": 30,
            "googleClientId": "client.apps.googleusercontent.com"
        }))
        .unwrap();
        let preferences = serde_json::to_value(preferences).unwrap();
        assert_eq!(preferences["theme"], "system");
        assert_eq!(preferences["surfaceColor"], "#eef2f8");
        assert_eq!(preferences["defaultView"], "month");
        assert_eq!(preferences["syncIntervalMinutes"], 30);
        assert_eq!(
            preferences["googleClientId"],
            "client.apps.googleusercontent.com"
        );

        let task = serde_json::to_value(Task {
            id: "task".into(),
            title: "Review".into(),
            notes: None,
            status: "completed".into(),
            due: None,
            completed: true,
            completed_at: Some("2026-07-29T10:00:00Z".into()),
            updated_at: "2026-07-29T11:00:00Z".into(),
            read_only: true,
        })
        .unwrap();
        assert_eq!(task["completed"], true);
        assert_eq!(task["updatedAt"], "2026-07-29T11:00:00Z");

        let note = serde_json::to_value(KeepNote {
            id: "note".into(),
            kind: KeepNoteKind::Checklist,
            title: "Shopping".into(),
            body: String::new(),
            items: vec![KeepNoteItem {
                id: "item".into(),
                text: "Milk".into(),
                checked: true,
            }],
            color: "yellow".into(),
            pinned: false,
            archived: false,
            created_at: "2026-07-29T10:00:00Z".into(),
            updated_at: "2026-07-29T11:00:00Z".into(),
        })
        .unwrap();
        assert_eq!(note["kind"], "checklist");
        assert_eq!(note["items"][0]["checked"], true);
        assert!(
            serde_json::from_value::<KeepNoteInput>(serde_json::json!({
                "kind": "unknown",
                "title": "Invalid",
                "body": "",
                "items": [],
                "color": "white",
                "pinned": false,
                "archived": false
            }))
            .is_err()
        );
    }

    #[test]
    fn event_requests_use_email_arrays_and_distinguish_null_from_missing() {
        let input: EventInput = serde_json::from_value(serde_json::json!({
            "calendarId": "primary",
            "title": "Planning",
            "start": "2026-07-29T09:00:00Z",
            "end": "2026-07-29T10:00:00Z",
            "attendees": ["person@example.com"],
            "privacy": "private",
            "availability": "free"
        }))
        .unwrap();
        let google = input.to_google_json("event");
        assert_eq!(google["attendees"][0]["email"], "person@example.com");
        assert_eq!(google["visibility"], "private");
        assert_eq!(google["transparency"], "transparent");

        let patch: EventPatch = serde_json::from_value(serde_json::json!({
            "description": null
        }))
        .unwrap();
        assert_eq!(patch.description, Some(None));
        assert!(patch.location.is_none());
    }

    #[test]
    fn sync_state_is_an_overview_object() {
        let state = SyncState::from_details(&[
            DetailedSyncState {
                account_id: "sub".into(),
                resource_type: "events".into(),
                resource_id: "primary".into(),
                last_sync_at: Some("2026-07-29T10:00:00Z".into()),
                status: "idle".into(),
                error: None,
            },
            DetailedSyncState {
                account_id: "sub".into(),
                resource_type: "tasks".into(),
                resource_id: String::new(),
                last_sync_at: Some("2026-07-29T11:00:00Z".into()),
                status: "error".into(),
                error: Some("Tasks unavailable".into()),
            },
        ]);
        assert_eq!(
            serde_json::to_value(state).unwrap(),
            serde_json::json!({
                "status": "error", "lastSyncedAt": "2026-07-29T11:00:00Z", "message": "Tasks unavailable"
            })
        );
    }
}
