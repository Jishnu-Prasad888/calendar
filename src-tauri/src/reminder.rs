use std::{fmt::Display, time::Duration};

use chrono::{DateTime, Local, LocalResult, NaiveDate, TimeZone, Utc};
use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use tokio::time::MissedTickBehavior;

use crate::{
    db::{ReminderEvent, Repository},
    error::AppResult,
};

const CHECK_INTERVAL: Duration = Duration::from_secs(30);
const DELIVERY_GRACE: chrono::Duration = chrono::Duration::hours(6);
const DELIVERY_RETENTION: chrono::Duration = chrono::Duration::days(90);

#[derive(Debug, PartialEq, Eq)]
struct DueReminder {
    reminder_time: DateTime<Utc>,
    title: String,
    body: String,
}

pub fn spawn(app: AppHandle, repo: Repository) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(CHECK_INTERVAL);
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if let Err(error) = check_due_reminders(&app, &repo).await {
                eprintln!("reminder scheduler check failed: {error}");
            }
        }
    });
}

async fn check_due_reminders(app: &AppHandle, repo: &Repository) -> AppResult<()> {
    let now = Utc::now();
    repo.prune_delivered_reminders(&(now - DELIVERY_RETENTION).to_rfc3339())
        .await?;
    if !repo.preferences().await?.notifications_enabled {
        return Ok(());
    }

    for event in repo.reminder_events().await? {
        for reminder in due_reminders(&event, now, &Local) {
            let reminder_time = reminder.reminder_time.to_rfc3339();
            if !repo
                .claim_reminder(&event, &reminder_time, &now.to_rfc3339())
                .await?
            {
                continue;
            }
            if app
                .notification()
                .builder()
                .title(reminder.title)
                .body(reminder.body)
                .show()
                .is_err()
            {
                if repo.release_reminder(&event, &reminder_time).await.is_err() {
                    eprintln!("could not release a failed reminder delivery claim");
                }
                eprintln!("could not display an event reminder notification");
            }
        }
    }
    Ok(())
}

fn due_reminders<Tz>(event: &ReminderEvent, now: DateTime<Utc>, timezone: &Tz) -> Vec<DueReminder>
where
    Tz: TimeZone,
    Tz::Offset: Display,
{
    let Ok(event_json) = serde_json::from_str::<Value>(&event.event_json) else {
        return Vec::new();
    };
    let Ok(calendar_json) = serde_json::from_str::<Value>(&event.calendar_json) else {
        return Vec::new();
    };
    let Some((start, end)) = event_bounds(event, timezone) else {
        return Vec::new();
    };
    if now >= end {
        return Vec::new();
    }

    let private = event_json.get("visibility").and_then(Value::as_str) == Some("private");
    let title = if private {
        "Private event".to_owned()
    } else {
        clean_text(&event.title, 100).unwrap_or_else(|| "Calendar event".into())
    };
    let mut body = if event.all_day != 0 {
        format!(
            "All day {}",
            start.with_timezone(timezone).format("%a, %b %-d")
        )
    } else {
        start
            .with_timezone(timezone)
            .format("%a, %b %-d at %I:%M %p")
            .to_string()
    };
    if !private
        && let Some(location) = event
            .location
            .as_deref()
            .and_then(|value| clean_text(value, 120))
    {
        body.push_str(" - ");
        body.push_str(&location);
    }

    popup_minutes(&event_json, &calendar_json)
        .into_iter()
        .filter_map(|minutes| {
            let reminder_time = start.checked_sub_signed(chrono::Duration::minutes(minutes))?;
            (reminder_time <= now && now - reminder_time <= DELIVERY_GRACE).then(|| DueReminder {
                reminder_time,
                title: title.clone(),
                body: body.clone(),
            })
        })
        .collect()
}

fn popup_minutes(event: &Value, calendar: &Value) -> Vec<i64> {
    let reminders = event.get("reminders").unwrap_or(&Value::Null);
    let values = if reminders.get("useDefault").and_then(Value::as_bool) == Some(true) {
        calendar.get("defaultReminders")
    } else {
        reminders.get("overrides")
    };
    let mut minutes: Vec<_> = values
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|reminder| reminder.get("method").and_then(Value::as_str) == Some("popup"))
        .filter_map(|reminder| reminder.get("minutes").and_then(Value::as_i64))
        .filter(|minutes| *minutes >= 0)
        .collect();
    minutes.sort_unstable();
    minutes.dedup();
    minutes
}

fn event_bounds<Tz>(event: &ReminderEvent, timezone: &Tz) -> Option<(DateTime<Utc>, DateTime<Utc>)>
where
    Tz: TimeZone,
{
    if event.all_day != 0 {
        let start = local_start_of_day(
            NaiveDate::parse_from_str(&event.start_time, "%Y-%m-%d").ok()?,
            timezone,
        )?;
        let end = local_start_of_day(
            NaiveDate::parse_from_str(&event.end_time, "%Y-%m-%d").ok()?,
            timezone,
        )?;
        (end > start).then_some((start, end))
    } else {
        let start = DateTime::parse_from_rfc3339(&event.start_time)
            .ok()?
            .with_timezone(&Utc);
        let end = DateTime::parse_from_rfc3339(&event.end_time)
            .ok()?
            .with_timezone(&Utc);
        (end > start).then_some((start, end))
    }
}

fn local_start_of_day<Tz>(date: NaiveDate, timezone: &Tz) -> Option<DateTime<Utc>>
where
    Tz: TimeZone,
{
    let midnight = date.and_hms_opt(0, 0, 0)?;
    (0..=180).find_map(|minutes| {
        let local = midnight.checked_add_signed(chrono::Duration::minutes(minutes))?;
        match timezone.from_local_datetime(&local) {
            LocalResult::Single(value) => Some(value.with_timezone(&Utc)),
            LocalResult::Ambiguous(first, second) => Some(std::cmp::min(
                first.with_timezone(&Utc),
                second.with_timezone(&Utc),
            )),
            LocalResult::None => None,
        }
    })
}

fn clean_text(value: &str, max_chars: usize) -> Option<String> {
    let cleaned: String = value
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(max_chars)
        .collect();
    (!cleaned.is_empty()).then_some(cleaned)
}

#[cfg(test)]
mod tests {
    use chrono::FixedOffset;

    use super::*;

    fn event(event_json: Value, calendar_json: Value) -> ReminderEvent {
        ReminderEvent {
            account_id: "account".into(),
            calendar_id: "calendar".into(),
            event_id: "event".into(),
            title: "Planning".into(),
            location: Some("Room 2".into()),
            start_time: "2026-07-29T10:00:00+02:00".into(),
            end_time: "2026-07-29T11:00:00+02:00".into(),
            all_day: 0,
            event_json: event_json.to_string(),
            calendar_json: calendar_json.to_string(),
        }
    }

    #[test]
    fn selects_popup_overrides_or_calendar_defaults() {
        let calendar = serde_json::json!({
            "defaultReminders": [
                {"method": "popup", "minutes": 30},
                {"method": "email", "minutes": 60}
            ]
        });
        let overrides = serde_json::json!({
            "reminders": {"useDefault": false, "overrides": [
                {"method": "email", "minutes": 20},
                {"method": "popup", "minutes": 10},
                {"method": "popup", "minutes": 10}
            ]}
        });
        assert_eq!(popup_minutes(&overrides, &calendar), vec![10]);
        assert_eq!(
            popup_minutes(
                &serde_json::json!({"reminders": {"useDefault": true}}),
                &calendar
            ),
            vec![30]
        );
    }

    #[test]
    fn calculates_timed_and_local_all_day_reminders() {
        let timezone = FixedOffset::east_opt(2 * 60 * 60).unwrap();
        let timed = event(
            serde_json::json!({"reminders": {"useDefault": false, "overrides": [
                {"method": "popup", "minutes": 10}
            ]}}),
            serde_json::json!({}),
        );
        let now = DateTime::parse_from_rfc3339("2026-07-29T09:52:00+02:00")
            .unwrap()
            .with_timezone(&Utc);
        let due = due_reminders(&timed, now, &timezone);
        assert_eq!(due.len(), 1);
        assert_eq!(
            due[0].reminder_time.to_rfc3339(),
            "2026-07-29T07:50:00+00:00"
        );

        let mut all_day = timed;
        all_day.start_time = "2026-07-30".into();
        all_day.end_time = "2026-07-31".into();
        all_day.all_day = 1;
        all_day.event_json = serde_json::json!({"reminders": {"useDefault": false, "overrides": [
            {"method": "popup", "minutes": 60}
        ]}})
        .to_string();
        let (start, _) = event_bounds(&all_day, &timezone).unwrap();
        assert_eq!(start.to_rfc3339(), "2026-07-29T22:00:00+00:00");
    }

    #[test]
    fn applies_grace_but_never_notifies_after_event_end() {
        let timezone = FixedOffset::east_opt(0).unwrap();
        let value = event(
            serde_json::json!({"reminders": {"overrides": [
                {"method": "popup", "minutes": 120}
            ]}}),
            serde_json::json!({}),
        );
        let during = DateTime::parse_from_rfc3339("2026-07-29T08:30:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(due_reminders(&value, during, &timezone).len(), 1);
        let ended = DateTime::parse_from_rfc3339("2026-07-29T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert!(due_reminders(&value, ended, &timezone).is_empty());
    }

    #[test]
    fn private_reminders_hide_title_and_location() {
        let timezone = FixedOffset::east_opt(2 * 60 * 60).unwrap();
        let value = event(
            serde_json::json!({"visibility": "private", "reminders": {"overrides": [
                {"method": "popup", "minutes": 10}
            ]}}),
            serde_json::json!({}),
        );
        let now = DateTime::parse_from_rfc3339("2026-07-29T09:51:00+02:00")
            .unwrap()
            .with_timezone(&Utc);
        let due = due_reminders(&value, now, &timezone);
        assert_eq!(due[0].title, "Private event");
        assert!(!due[0].body.contains("Room 2"));
    }

    #[tokio::test]
    async fn reminder_claims_suppress_duplicates() {
        let repo = Repository::memory().await.unwrap();
        let value = event(serde_json::json!({}), serde_json::json!({}));
        assert!(
            repo.claim_reminder(&value, "2026-07-29T08:00:00Z", "2026-07-29T08:00:01Z")
                .await
                .unwrap()
        );
        assert!(
            !repo
                .claim_reminder(&value, "2026-07-29T08:00:00Z", "2026-07-29T08:00:02Z")
                .await
                .unwrap()
        );
    }
}
