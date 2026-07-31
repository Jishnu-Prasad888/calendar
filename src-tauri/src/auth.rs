use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
    time::Duration,
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use rand::RngCore;
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;
use tokio::{io::AsyncReadExt, io::AsyncWriteExt, net::TcpListener, sync::Mutex};
use url::Url;

use crate::{
    error::{AppError, AppResult},
    model::{Account, OAuthConfiguration},
};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const SCOPES: &str = "openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks";
const KEYRING_SERVICE: &str = "app.claycalendar.desktop.google-oauth";
const CLIENT_SECRET_KEY: &str = "oauth-client-secret";

#[derive(Clone)]
pub struct AuthService {
    client_id: Arc<RwLock<Option<String>>>,
    client_secret: Arc<RwLock<Option<String>>>,
    http: Client,
    access_tokens: Arc<Mutex<HashMap<String, AccessToken>>>,
}

#[derive(Clone)]
struct AccessToken {
    value: String,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: i64,
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OAuthErrorResponse {
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UserInfo {
    sub: String,
    email: String,
    #[serde(default)]
    name: String,
    picture: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PkceChallenge {
    pub verifier: String,
    pub challenge: String,
    pub state: String,
}

impl PkceChallenge {
    pub fn generate() -> Self {
        let verifier = random_urlsafe(64);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        Self {
            verifier,
            challenge,
            state: random_urlsafe(32),
        }
    }
}

impl AuthService {
    pub fn new(client_id: &str, client_secret: Option<String>) -> AppResult<Self> {
        Ok(Self {
            client_id: Arc::new(RwLock::new(normalize_client_id(client_id))),
            client_secret: Arc::new(RwLock::new(client_secret)),
            http: Client::builder().timeout(Duration::from_secs(30)).build()?,
            access_tokens: Default::default(),
        })
    }

    pub async fn authorize<R: Runtime>(&self, app: &AppHandle<R>) -> AppResult<Account> {
        let client_id = self.client_id()?;
        let client_secret = self.client_secret()?;
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
        let port = listener.local_addr()?.port();
        let redirect_uri = format!("http://127.0.0.1:{port}/oauth/callback");
        let pkce = PkceChallenge::generate();
        let mut auth_url = Url::parse(AUTH_URL)
            .map_err(|error| AppError::Internal(format!("invalid OAuth URL: {error}")))?;
        auth_url
            .query_pairs_mut()
            .append_pair("client_id", &client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", SCOPES)
            .append_pair("state", &pkce.state)
            .append_pair("code_challenge", &pkce.challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent")
            .append_pair("include_granted_scopes", "true");

        app.opener()
            .open_url(auth_url.as_str(), None::<&str>)
            .map_err(|error| {
                AppError::Authentication(format!("could not open browser: {error}"))
            })?;

        let callback = tokio::time::timeout(Duration::from_secs(300), receive_callback(listener))
            .await
            .map_err(|_| AppError::Authentication("authorization timed out".into()))??;
        if callback.state.as_deref() != Some(&pkce.state) {
            return Err(AppError::Authentication(
                "OAuth state did not match; authorization was rejected".into(),
            ));
        }
        if let Some(error) = callback.error {
            return Err(AppError::Authentication(format!(
                "Google rejected authorization: {error}"
            )));
        }
        let code = callback.code.ok_or_else(|| {
            AppError::Authentication("OAuth callback did not include a code".into())
        })?;
        let tokens = self
            .exchange_code(
                &client_id,
                &client_secret,
                &code,
                &redirect_uri,
                &pkce.verifier,
            )
            .await?;
        let user: UserInfo = self
            .http
            .get(USERINFO_URL)
            .bearer_auth(&tokens.access_token)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let refresh_token = tokens.refresh_token.as_deref().ok_or_else(|| {
            AppError::Authentication(
                "Google did not return a refresh token; revoke app access and try again".into(),
            )
        })?;
        store_refresh_token(&user.sub, refresh_token).await?;
        self.cache_access_token(&user.sub, &tokens).await;
        Ok(Account {
            id: user.sub,
            email: user.email,
            display_name: user.name,
            avatar_url: user.picture,
            connected: true,
        })
    }

    pub async fn access_token(&self, account_id: &str) -> AppResult<String> {
        let client_id = self.client_id()?;
        let client_secret = self.client_secret()?;
        {
            let cache = self.access_tokens.lock().await;
            if let Some(token) = cache.get(account_id)
                && token.expires_at > Utc::now() + chrono::Duration::seconds(60)
            {
                return Ok(token.value.clone());
            }
        }
        let refresh_token = load_refresh_token(account_id).await?;
        let response = self
            .http
            .post(TOKEN_URL)
            .form(&[
                ("client_id", client_id.as_str()),
                ("client_secret", client_secret.as_str()),
                ("refresh_token", refresh_token.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Authentication(oauth_error_message(
                "could not refresh Google access",
                status,
                &body,
            )));
        }
        let tokens: TokenResponse = response.json().await?;
        let value = tokens.access_token.clone();
        self.cache_access_token(account_id, &tokens).await;
        Ok(value)
    }

    pub async fn invalidate_access_token(&self, account_id: &str) {
        self.access_tokens.lock().await.remove(account_id);
    }

    pub async fn revoke(&self, account_id: &str) -> AppResult<()> {
        if let Ok(token) = load_refresh_token(account_id).await {
            let _ = self
                .http
                .post(REVOKE_URL)
                .form(&[("token", token.as_str())])
                .send()
                .await;
        }
        delete_refresh_token(account_id).await?;
        self.access_tokens.lock().await.remove(account_id);
        Ok(())
    }

    async fn exchange_code(
        &self,
        client_id: &str,
        client_secret: &str,
        code: &str,
        redirect_uri: &str,
        verifier: &str,
    ) -> AppResult<TokenResponse> {
        let response = self
            .http
            .post(TOKEN_URL)
            .form(&[
                ("client_id", client_id),
                ("client_secret", client_secret),
                ("code", code),
                ("code_verifier", verifier),
                ("redirect_uri", redirect_uri),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Authentication(oauth_error_message(
                "OAuth code exchange failed",
                status,
                &body,
            )));
        }
        Ok(response.json().await?)
    }

    async fn cache_access_token(&self, account_id: &str, tokens: &TokenResponse) {
        self.access_tokens.lock().await.insert(
            account_id.to_owned(),
            AccessToken {
                value: tokens.access_token.clone(),
                expires_at: Utc::now() + chrono::Duration::seconds(tokens.expires_in.max(60)),
            },
        );
    }

    pub fn ensure_configured(&self) -> AppResult<()> {
        self.client_id()?;
        self.client_secret()?;
        Ok(())
    }

    pub fn configuration(&self) -> AppResult<OAuthConfiguration> {
        Ok(OAuthConfiguration {
            client_id: self
                .client_id
                .read()
                .map_err(|_| AppError::Internal("OAuth configuration lock was poisoned".into()))?
                .clone()
                .unwrap_or_default(),
            client_secret_configured: self
                .client_secret
                .read()
                .map_err(|_| AppError::Internal("OAuth configuration lock was poisoned".into()))?
                .is_some(),
        })
    }

    pub async fn set_client_id(&self, client_id: &str) -> AppResult<()> {
        *self
            .client_id
            .write()
            .map_err(|_| AppError::Internal("OAuth configuration lock was poisoned".into()))? =
            normalize_client_id(client_id);
        self.access_tokens.lock().await.clear();
        Ok(())
    }

    pub async fn set_client_secret(&self, client_secret: &str) -> AppResult<()> {
        let client_secret = client_secret.trim();
        if client_secret.is_empty() {
            return Err(AppError::Validation(
                "Google OAuth client secret cannot be empty".into(),
            ));
        }
        store_keyring_value(CLIENT_SECRET_KEY, client_secret).await?;
        *self
            .client_secret
            .write()
            .map_err(|_| AppError::Internal("OAuth configuration lock was poisoned".into()))? =
            Some(client_secret.to_owned());
        self.access_tokens.lock().await.clear();
        Ok(())
    }

    pub async fn stored_client_secret() -> AppResult<Option<String>> {
        load_optional_keyring_value(CLIENT_SECRET_KEY).await
    }

    fn client_id(&self) -> AppResult<String> {
        self.client_id
            .read()
            .map_err(|_| AppError::Internal("OAuth configuration lock was poisoned".into()))?
            .clone()
            .ok_or_else(|| {
                AppError::Configuration(
                "Google OAuth client ID is not configured; add it in Settings > Google accounts"
                    .into(),
            )
            })
    }

    fn client_secret(&self) -> AppResult<String> {
        self.client_secret
            .read()
            .map_err(|_| AppError::Internal("OAuth configuration lock was poisoned".into()))?
            .clone()
            .ok_or_else(|| {
                AppError::Configuration(
                    "Google OAuth client secret is not configured; add it in Settings > Google accounts"
                        .into(),
                )
            })
    }
}

fn normalize_client_id(client_id: &str) -> Option<String> {
    let client_id = client_id.trim();
    (!client_id.is_empty()).then(|| client_id.to_owned())
}

fn oauth_error_message(context: &str, status: StatusCode, body: &str) -> String {
    let parsed = serde_json::from_str::<OAuthErrorResponse>(body).ok();
    let code = parsed.as_ref().and_then(|error| error.error.as_deref());
    let description = parsed
        .as_ref()
        .and_then(|error| error.error_description.as_deref());
    let details = match (code, description) {
        (Some(code), Some(description)) => format!("{code}: {description}"),
        (Some(code), None) => code.to_owned(),
        (None, Some(description)) => description.to_owned(),
        (None, None) => status
            .canonical_reason()
            .unwrap_or("Google rejected the request")
            .to_owned(),
    };
    format!("{context} (HTTP {status}): {details}")
}

struct OAuthCallback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

async fn receive_callback(listener: TcpListener) -> AppResult<OAuthCallback> {
    let (mut stream, address) = listener.accept().await?;
    if !address.ip().is_loopback() {
        return Err(AppError::Authentication(
            "OAuth callback was not from the loopback interface".into(),
        ));
    }
    let mut buffer = [0_u8; 8192];
    let bytes = stream.read(&mut buffer).await?;
    let request = std::str::from_utf8(&buffer[..bytes])
        .map_err(|_| AppError::Authentication("invalid OAuth callback request".into()))?;
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| AppError::Authentication("malformed OAuth callback request".into()))?;
    let url = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| AppError::Authentication("malformed OAuth callback URL".into()))?;
    if url.path() != "/oauth/callback" {
        return Err(AppError::Authentication(
            "unexpected OAuth callback path".into(),
        ));
    }
    let parameters: HashMap<_, _> = url.query_pairs().into_owned().collect();
    let success = parameters.contains_key("code") && !parameters.contains_key("error");
    let body = if success {
        "Authorization complete. You can close this window and return to Clay Calendar."
    } else {
        "Authorization was not completed. You can close this window."
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.shutdown().await?;
    Ok(OAuthCallback {
        code: parameters.get("code").cloned(),
        state: parameters.get("state").cloned(),
        error: parameters.get("error").cloned(),
    })
}

fn random_urlsafe(bytes: usize) -> String {
    let mut data = vec![0_u8; bytes];
    rand::rng().fill_bytes(&mut data);
    URL_SAFE_NO_PAD.encode(data)
}

async fn store_refresh_token(account_id: &str, token: &str) -> AppResult<()> {
    store_keyring_value(account_id, token).await
}

async fn store_keyring_value(key: &str, value: &str) -> AppResult<()> {
    let key = key.to_owned();
    let value = value.to_owned();
    tokio::task::spawn_blocking(move || {
        keyring::Entry::new(KEYRING_SERVICE, &key)?.set_password(&value)
    })
    .await
    .map_err(|error| AppError::Internal(format!("keyring task failed: {error}")))??;
    Ok(())
}

async fn load_refresh_token(account_id: &str) -> AppResult<String> {
    let account_id = account_id.to_owned();
    tokio::task::spawn_blocking(move || {
        keyring::Entry::new(KEYRING_SERVICE, &account_id)?.get_password()
    })
    .await
    .map_err(|error| AppError::Internal(format!("keyring task failed: {error}")))?
    .map_err(AppError::from)
}

async fn load_optional_keyring_value(key: &str) -> AppResult<Option<String>> {
    let key = key.to_owned();
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(KEYRING_SERVICE, &key)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error),
        }
    })
    .await
    .map_err(|error| AppError::Internal(format!("keyring task failed: {error}")))?
    .map_err(AppError::from)
}

async fn delete_refresh_token(account_id: &str) -> AppResult<()> {
    let account_id = account_id.to_owned();
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(KEYRING_SERVICE, &account_id)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error),
        }
    })
    .await
    .map_err(|error| AppError::Internal(format!("keyring task failed: {error}")))??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_is_s256_and_random() {
        let first = PkceChallenge::generate();
        let second = PkceChallenge::generate();
        assert_eq!(
            first.challenge,
            URL_SAFE_NO_PAD.encode(Sha256::digest(first.verifier.as_bytes()))
        );
        assert_ne!(first.verifier, second.verifier);
        assert_ne!(first.state, second.state);
        assert!(first.verifier.len() >= 43);
    }

    #[test]
    fn missing_build_credentials_do_not_prevent_service_creation() {
        let service = AuthService::new("", None).unwrap();
        assert!(matches!(
            service.ensure_configured(),
            Err(AppError::Configuration(_))
        ));
        assert!(AuthService::new("configured.apps.googleusercontent.com", None).is_ok());
    }

    #[tokio::test]
    async fn client_id_can_be_configured_at_runtime() {
        let service = AuthService::new("", Some("secret".into())).unwrap();
        service
            .set_client_id(" runtime.apps.googleusercontent.com ")
            .await
            .unwrap();
        assert!(service.ensure_configured().is_ok());
        assert_eq!(
            service.client_id().unwrap(),
            "runtime.apps.googleusercontent.com"
        );
    }

    #[test]
    fn oauth_errors_include_google_error_details() {
        let message = oauth_error_message(
            "OAuth code exchange failed",
            StatusCode::BAD_REQUEST,
            r#"{"error":"invalid_grant","error_description":"Bad Request"}"#,
        );
        assert_eq!(
            message,
            "OAuth code exchange failed (HTTP 400 Bad Request): invalid_grant: Bad Request"
        );
    }
}
