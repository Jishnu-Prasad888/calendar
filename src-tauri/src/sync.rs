use std::collections::HashSet;

use reqwest::Method;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::{
    db::{PendingMutation, Repository},
    error::{AppError, AppResult},
    google::{ApiError, GoogleClient},
    model::{Calendar, SyncState, SyncStatus, SyncSummary},
};

#[derive(Clone)]
pub struct SyncEngine {
    repo: Repository,
    google: GoogleClient,
    app: AppHandle,
    lock: std::sync::Arc<tokio::sync::Mutex<()>>,
}

impl SyncEngine {
    pub fn new(repo: Repository, google: GoogleClient, app: AppHandle) -> Self {
        Self {
            repo,
            google,
            app,
            lock: Default::default(),
        }
    }

    pub async fn sync_all(&self) -> AppResult<SyncSummary> {
        let _guard = self.lock.lock().await;
        self.emit_state(SyncState {
            status: SyncStatus::Syncing,
            last_synced_at: None,
            message: None,
        });
        let result = self.sync_all_inner().await;
        let state = match &result {
            Ok(_) => self
                .repo
                .sync_overview()
                .await
                .unwrap_or_else(|error| SyncState {
                    status: SyncStatus::Error,
                    last_synced_at: None,
                    message: Some(error.to_string()),
                }),
            Err(error) => SyncState {
                status: SyncStatus::Error,
                last_synced_at: None,
                message: Some(error.to_string()),
            },
        };
        self.emit_state(state);
        result
    }

    async fn sync_all_inner(&self) -> AppResult<SyncSummary> {
        let mut summary = SyncSummary::default();
        self.process_mutations(&mut summary).await?;
        for account in self.repo.accounts().await? {
            match self.sync_account(&account.id, &mut summary).await {
                Ok(()) => summary.accounts_synced += 1,
                Err(error) => {
                    let message = error.to_string();
                    self.repo
                        .set_sync_state(&account.id, "account", "", None, "error", Some(&message))
                        .await?;
                    summary.errors.push(format!("{}: {message}", account.email));
                }
            }
        }
        Ok(summary)
    }

    fn emit_state(&self, state: SyncState) {
        let _ = self.app.emit("sync-state-changed", state);
    }

    async fn sync_account(&self, account_id: &str, summary: &mut SyncSummary) -> AppResult<()> {
        self.repo
            .set_sync_state(account_id, "account", "", None, "syncing", None)
            .await?;
        summary.calendars_changed += self.sync_calendars(account_id).await?;
        let preferences = self.repo.preferences().await?;
        let configured: HashSet<&str> = preferences
            .selected_calendar_ids
            .iter()
            .map(String::as_str)
            .collect();
        let calendars = self.repo.calendars().await?;
        for calendar in calendars.into_iter().filter(|calendar| {
            calendar.account_id == account_id
                && if configured.is_empty() {
                    calendar.visible
                } else {
                    configured.contains(calendar.id.as_str())
                }
        }) {
            summary.events_changed += self.sync_events(account_id, &calendar).await?;
        }
        if preferences.show_tasks {
            summary.tasks_changed += self.sync_tasks(account_id).await?;
        }
        self.repo
            .set_sync_state(account_id, "account", "", None, "idle", None)
            .await?;
        Ok(())
    }

    async fn sync_calendars(&self, account_id: &str) -> AppResult<u32> {
        let token = self.repo.sync_token(account_id, "calendarList", "").await?;
        match self.calendar_pages(account_id, token.as_deref()).await {
            Ok(result) => {
                self.save_calendars(account_id, token.is_none(), result)
                    .await
            }
            Err(error) if error.is_gone() && token.is_some() => {
                self.repo
                    .clear_sync_token(account_id, "calendarList", "")
                    .await?;
                let result = self
                    .calendar_pages(account_id, None)
                    .await
                    .map_err(api_error)?;
                self.save_calendars(account_id, true, result).await
            }
            Err(error) => Err(api_error(error)),
        }
    }

    async fn calendar_pages(
        &self,
        account_id: &str,
        sync_token: Option<&str>,
    ) -> Result<PageResult, ApiError> {
        let mut page_token: Option<String> = None;
        let mut items = Vec::new();
        loop {
            let mut url = GoogleClient::calendar_url(&["users", "me", "calendarList"])
                .map_err(internal_api_error)?;
            url.query_pairs_mut()
                .append_pair("maxResults", "250")
                .append_pair("showDeleted", "true");
            if let Some(token) = sync_token {
                url.query_pairs_mut().append_pair("syncToken", token);
            }
            if let Some(token) = &page_token {
                url.query_pairs_mut().append_pair("pageToken", token);
            }
            let response = self.google.get(account_id, url).await?;
            items.extend(array(&response, "items"));
            page_token = response
                .get("nextPageToken")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if page_token.is_none() {
                return Ok(PageResult {
                    items,
                    sync_token: response
                        .get("nextSyncToken")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                });
            }
        }
    }

    async fn save_calendars(
        &self,
        account_id: &str,
        initial: bool,
        result: PageResult,
    ) -> AppResult<u32> {
        let mut changed = 0;
        let mut ids = Vec::new();
        for item in result.items {
            if item.get("deleted").and_then(Value::as_bool) != Some(true)
                && let Some(id) = item.get("id").and_then(Value::as_str)
            {
                ids.push(id.to_owned());
            }
            changed += u32::from(self.repo.upsert_calendar(account_id, &item).await?);
        }
        if initial {
            self.repo
                .mark_missing_calendars_deleted(account_id, &ids)
                .await?;
        }
        self.repo
            .set_sync_state(
                account_id,
                "calendarList",
                "",
                result.sync_token.as_deref(),
                "idle",
                None,
            )
            .await?;
        Ok(changed)
    }

    async fn sync_events(&self, account_id: &str, calendar: &Calendar) -> AppResult<u32> {
        let token = self
            .repo
            .sync_token(account_id, "events", &calendar.id)
            .await?;
        let mut full_resync = token.is_none();
        let result = match self
            .event_pages(account_id, &calendar.id, token.as_deref())
            .await
        {
            Ok(result) => result,
            Err(error) if error.is_gone() && token.is_some() => {
                full_resync = true;
                self.repo
                    .clear_sync_token(account_id, "events", &calendar.id)
                    .await?;
                self.event_pages(account_id, &calendar.id, None)
                    .await
                    .map_err(api_error)?
            }
            Err(error) => return Err(api_error(error)),
        };
        let mut changed = 0;
        let mut active_ids = Vec::new();
        for event in result.items {
            let event_id = event
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::Validation("Google event missing id".into()))?;
            if event.get("status").and_then(Value::as_str) == Some("cancelled") {
                self.repo
                    .delete_event_local(account_id, &calendar.id, event_id, false)
                    .await?;
                changed += 1;
            } else {
                active_ids.push(event_id.to_owned());
                changed += u32::from(
                    self.repo
                        .upsert_event(account_id, &calendar.id, &event, false)
                        .await?,
                );
            }
        }
        if full_resync {
            self.repo
                .mark_missing_events_deleted(account_id, &calendar.id, &active_ids)
                .await?;
        }
        self.repo
            .set_sync_state(
                account_id,
                "events",
                &calendar.id,
                result.sync_token.as_deref(),
                "idle",
                None,
            )
            .await?;
        Ok(changed)
    }

    async fn event_pages(
        &self,
        account_id: &str,
        calendar_id: &str,
        sync_token: Option<&str>,
    ) -> Result<PageResult, ApiError> {
        let mut page_token: Option<String> = None;
        let mut items = Vec::new();
        loop {
            let mut url = GoogleClient::calendar_url(&["calendars", calendar_id, "events"])
                .map_err(internal_api_error)?;
            url.query_pairs_mut()
                .append_pair("maxResults", "2500")
                .append_pair("singleEvents", "true")
                .append_pair("showDeleted", "true");
            if let Some(token) = sync_token {
                url.query_pairs_mut().append_pair("syncToken", token);
            }
            if let Some(token) = &page_token {
                url.query_pairs_mut().append_pair("pageToken", token);
            }
            let response = self.google.get(account_id, url).await?;
            items.extend(array(&response, "items"));
            page_token = response
                .get("nextPageToken")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if page_token.is_none() {
                return Ok(PageResult {
                    items,
                    sync_token: response
                        .get("nextSyncToken")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                });
            }
        }
    }

    async fn sync_tasks(&self, account_id: &str) -> AppResult<u32> {
        let mut lists = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let mut url = GoogleClient::tasks_url(&["users", "@me", "lists"])?;
            url.query_pairs_mut().append_pair("maxResults", "100");
            if let Some(token) = &page_token {
                url.query_pairs_mut().append_pair("pageToken", token);
            }
            let response = self.google.get(account_id, url).await.map_err(api_error)?;
            lists.extend(array(&response, "items"));
            page_token = response
                .get("nextPageToken")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if page_token.is_none() {
                break;
            }
        }
        let mut with_tasks = Vec::new();
        for list in lists {
            let id = list
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::Validation("Google task list missing id".into()))?;
            let mut tasks = Vec::new();
            let mut page_token: Option<String> = None;
            loop {
                let mut url = GoogleClient::tasks_url(&["lists", id, "tasks"])?;
                url.query_pairs_mut()
                    .append_pair("maxResults", "100")
                    .append_pair("showCompleted", "true")
                    .append_pair("showHidden", "true");
                if let Some(token) = &page_token {
                    url.query_pairs_mut().append_pair("pageToken", token);
                }
                let response = self.google.get(account_id, url).await.map_err(api_error)?;
                tasks.extend(array(&response, "items"));
                page_token = response
                    .get("nextPageToken")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                if page_token.is_none() {
                    break;
                }
            }
            with_tasks.push((list, tasks));
        }
        let changed = self
            .repo
            .replace_task_lists(account_id, &with_tasks)
            .await?;
        self.repo
            .set_sync_state(account_id, "tasks", "", None, "idle", None)
            .await?;
        Ok(changed)
    }

    async fn process_mutations(&self, summary: &mut SyncSummary) -> AppResult<()> {
        for mutation in self.repo.due_mutations().await? {
            match self.apply_mutation(&mutation).await {
                Ok(()) => {
                    self.repo.mutation_succeeded(mutation.id).await?;
                    summary.mutations_applied += 1;
                }
                Err(error) => {
                    let transient = error.is_transient();
                    let conflict = error.is_conflict();
                    self.repo
                        .mutation_failed(
                            mutation.id,
                            mutation.attempts,
                            &error.to_string(),
                            transient,
                        )
                        .await?;
                    if conflict {
                        summary.errors.push(format!(
                            "event {} changed remotely; local mutation was retained",
                            mutation.event_id
                        ));
                    } else if !transient {
                        summary.errors.push(format!(
                            "event {} mutation failed: {error}",
                            mutation.event_id
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    async fn apply_mutation(&self, mutation: &PendingMutation) -> Result<(), ApiError> {
        let url = GoogleClient::calendar_url(&[
            "calendars",
            &mutation.calendar_id,
            "events",
            &mutation.event_id,
        ])
        .map_err(internal_api_error)?;
        let payload = mutation
            .payload_json
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(|error| internal_api_error(AppError::Json(error)))?;
        let (method, body) = match mutation.operation.as_str() {
            "create" => {
                let url =
                    GoogleClient::calendar_url(&["calendars", &mutation.calendar_id, "events"])
                        .map_err(internal_api_error)?;
                let result = self
                    .google
                    .send(
                        &mutation.account_id,
                        Method::POST,
                        url,
                        payload.as_ref(),
                        None,
                    )
                    .await;
                let result = match result {
                    Ok(result) => result,
                    Err(error) if error.is_conflict() => {
                        let existing_url = GoogleClient::calendar_url(&[
                            "calendars",
                            &mutation.calendar_id,
                            "events",
                            &mutation.event_id,
                        ])
                        .map_err(internal_api_error)?;
                        Some(self.google.get(&mutation.account_id, existing_url).await?)
                    }
                    Err(error) => return Err(error),
                };
                return self.save_mutation_result(mutation, result).await;
            }
            "update" | "rsvp" => (Method::PATCH, payload.as_ref()),
            "delete" => (Method::DELETE, None),
            operation => {
                return Err(internal_api_error(AppError::Internal(format!(
                    "unknown queued operation {operation}"
                ))));
            }
        };
        let result = self
            .google
            .send(
                &mutation.account_id,
                method,
                url,
                body,
                mutation.base_etag.as_deref(),
            )
            .await;
        let result = match result {
            Ok(result) => result,
            Err(error)
                if mutation.operation == "delete"
                    && error.status == reqwest::StatusCode::NOT_FOUND =>
            {
                None
            }
            Err(error) => return Err(error),
        };
        self.save_mutation_result(mutation, result).await
    }

    async fn save_mutation_result(
        &self,
        mutation: &PendingMutation,
        result: Option<Value>,
    ) -> Result<(), ApiError> {
        if mutation.operation == "delete" {
            self.repo
                .delete_event_local(
                    &mutation.account_id,
                    &mutation.calendar_id,
                    &mutation.event_id,
                    false,
                )
                .await
                .map_err(internal_api_error)?;
        } else if let Some(event) = result {
            self.repo
                .upsert_event(&mutation.account_id, &mutation.calendar_id, &event, false)
                .await
                .map_err(internal_api_error)?;
        }
        Ok(())
    }
}

struct PageResult {
    items: Vec<Value>,
    sync_token: Option<String>,
}

fn array(value: &Value, key: &str) -> Vec<Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn api_error(error: ApiError) -> AppError {
    if error.is_conflict() {
        AppError::Conflict(error.to_string())
    } else {
        AppError::Google(error.to_string())
    }
}

fn internal_api_error(error: AppError) -> ApiError {
    ApiError {
        status: reqwest::StatusCode::INTERNAL_SERVER_ERROR,
        message: error.to_string(),
        reason: Some("localError".into()),
    }
}
