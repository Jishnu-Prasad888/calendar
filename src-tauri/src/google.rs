use std::time::Duration;

use reqwest::{Method, StatusCode};
use serde_json::Value;
use url::Url;

use crate::{
    auth::AuthService,
    error::{AppError, AppResult},
};

const CALENDAR_API: &str = "https://www.googleapis.com/calendar/v3/";
const TASKS_API: &str = "https://tasks.googleapis.com/tasks/v1/";

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
    pub reason: Option<String>,
}

impl ApiError {
    pub fn is_transient(&self) -> bool {
        self.status == StatusCode::TOO_MANY_REQUESTS
            || self.status.is_server_error()
            || matches!(
                self.reason.as_deref(),
                Some("rateLimitExceeded" | "userRateLimitExceeded" | "backendError")
            )
    }

    pub fn is_gone(&self) -> bool {
        self.status == StatusCode::GONE
    }

    pub fn is_conflict(&self) -> bool {
        matches!(
            self.status,
            StatusCode::CONFLICT | StatusCode::PRECONDITION_FAILED
        )
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "HTTP {}: {}", self.status, self.message)
    }
}

impl std::error::Error for ApiError {}

#[derive(Clone)]
pub struct GoogleClient {
    auth: AuthService,
    http: reqwest::Client,
}

impl GoogleClient {
    pub fn new(auth: AuthService) -> AppResult<Self> {
        Ok(Self {
            auth,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()?,
        })
    }

    pub fn calendar_url(segments: &[&str]) -> AppResult<Url> {
        api_url(CALENDAR_API, segments)
    }

    pub fn tasks_url(segments: &[&str]) -> AppResult<Url> {
        api_url(TASKS_API, segments)
    }

    pub async fn get(&self, account_id: &str, url: Url) -> Result<Value, ApiError> {
        self.request(account_id, Method::GET, url, None, None)
            .await?
            .ok_or_else(|| ApiError {
                status: StatusCode::NO_CONTENT,
                message: "Google returned an empty response".into(),
                reason: None,
            })
    }

    pub async fn send(
        &self,
        account_id: &str,
        method: Method,
        url: Url,
        body: Option<&Value>,
        etag: Option<&str>,
    ) -> Result<Option<Value>, ApiError> {
        self.request(account_id, method, url, body, etag).await
    }

    async fn request(
        &self,
        account_id: &str,
        method: Method,
        url: Url,
        body: Option<&Value>,
        etag: Option<&str>,
    ) -> Result<Option<Value>, ApiError> {
        for attempt in 0..=3 {
            let token = self
                .auth
                .access_token(account_id)
                .await
                .map_err(auth_error)?;
            let mut request = self
                .http
                .request(method.clone(), url.clone())
                .bearer_auth(token);
            if let Some(body) = body {
                request = request.json(body);
            }
            if let Some(etag) = etag {
                request = request.header(reqwest::header::IF_MATCH, etag);
            }
            let response = match request.send().await {
                Ok(response) => response,
                Err(_error) if attempt < 3 => {
                    tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
                    continue;
                }
                Err(error) => return Err(network_error(error)),
            };
            let status = response.status();
            if status.is_success() {
                if status == StatusCode::NO_CONTENT {
                    return Ok(None);
                }
                return response.json().await.map(Some).map_err(network_error);
            }
            let body = response.text().await.unwrap_or_default();
            let error = classify_error(status, &body);
            if status == StatusCode::UNAUTHORIZED && attempt == 0 {
                self.auth.invalidate_access_token(account_id).await;
                continue;
            }
            if error.is_transient() && attempt < 3 {
                tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
                continue;
            }
            return Err(error);
        }
        unreachable!("request retry loop always returns")
    }
}

fn api_url(base: &str, segments: &[&str]) -> AppResult<Url> {
    let mut url = Url::parse(base)
        .map_err(|error| AppError::Internal(format!("invalid Google API URL: {error}")))?;
    url.path_segments_mut()
        .map_err(|_| AppError::Internal("Google API URL cannot hold path segments".into()))?
        .extend(segments);
    Ok(url)
}

fn classify_error(status: StatusCode, body: &str) -> ApiError {
    let parsed: Value = serde_json::from_str(body).unwrap_or_default();
    let error = parsed.get("error").unwrap_or(&parsed);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_else(|| {
            status
                .canonical_reason()
                .unwrap_or("Google API request failed")
        })
        .to_owned();
    let reason = error
        .get("errors")
        .and_then(Value::as_array)
        .and_then(|errors| errors.first())
        .and_then(|error| error.get("reason"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    ApiError {
        status,
        message,
        reason,
    }
}

fn auth_error(error: AppError) -> ApiError {
    ApiError {
        status: StatusCode::UNAUTHORIZED,
        message: error.to_string(),
        reason: Some("authError".into()),
    }
}

fn network_error(error: reqwest::Error) -> ApiError {
    ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: error.to_string(),
        reason: Some("networkError".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_google_errors() {
        let rate_limit = classify_error(
            StatusCode::FORBIDDEN,
            r#"{"error":{"message":"slow down","errors":[{"reason":"rateLimitExceeded"}]}}"#,
        );
        assert!(rate_limit.is_transient());
        assert!(classify_error(StatusCode::GONE, "").is_gone());
        assert!(classify_error(StatusCode::PRECONDITION_FAILED, "").is_conflict());
        assert!(!classify_error(StatusCode::BAD_REQUEST, "").is_transient());
    }

    #[test]
    fn escapes_resource_ids_in_urls() {
        let url = GoogleClient::calendar_url(&["calendars", "team/calendar@example.com", "events"])
            .unwrap();
        assert!(url.as_str().contains("team%2Fcalendar@example.com"));
    }
}
