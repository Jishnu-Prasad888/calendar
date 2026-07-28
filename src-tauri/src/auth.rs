use std::{collections::HashMap, time::Duration};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use rand::RngCore;
use reqwest::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;
use tokio::{io::AsyncReadExt, io::AsyncWriteExt, net::TcpListener, sync::Mutex};
use url::Url;

use crate::{
    error::{AppError, AppResult},
    model::Account,
};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const SCOPES: &str = "openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks.readonly";
const KEYRING_SERVICE: &str = "app.claycalendar.desktop.google-oauth";

#[derive(Clone)]
pub struct AuthService {
    client_id: String,
    http: Client,
    access_tokens: std::sync::Arc<Mutex<HashMap<String, AccessToken>>>,
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
    pub fn from_build_config() -> AppResult<Self> {
        let client_id = option_env!("GOOGLE_CLIENT_ID")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                AppError::Configuration(
                    "GOOGLE_CLIENT_ID was not set when the Rust backend was compiled; set it and rebuild"
                        .into(),
                )
            })?;
        Ok(Self {
            client_id: client_id.to_owned(),
            http: Client::builder().timeout(Duration::from_secs(30)).build()?,
            access_tokens: Default::default(),
        })
    }

    pub async fn authorize<R: Runtime>(&self, app: &AppHandle<R>) -> AppResult<Account> {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
        let port = listener.local_addr()?.port();
        let redirect_uri = format!("http://127.0.0.1:{port}/oauth/callback");
        let pkce = PkceChallenge::generate();
        let mut auth_url = Url::parse(AUTH_URL)
            .map_err(|error| AppError::Internal(format!("invalid OAuth URL: {error}")))?;
        auth_url
            .query_pairs_mut()
            .append_pair("client_id", &self.client_id)
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
            .exchange_code(&code, &redirect_uri, &pkce.verifier)
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
            name: user.name,
            picture_url: user.picture,
        })
    }

    pub async fn access_token(&self, account_id: &str) -> AppResult<String> {
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
                ("client_id", self.client_id.as_str()),
                ("refresh_token", refresh_token.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(AppError::Authentication(format!(
                "could not refresh Google access (HTTP {})",
                response.status()
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
        code: &str,
        redirect_uri: &str,
        verifier: &str,
    ) -> AppResult<TokenResponse> {
        let response = self
            .http
            .post(TOKEN_URL)
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("code", code),
                ("code_verifier", verifier),
                ("redirect_uri", redirect_uri),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(AppError::Authentication(format!(
                "OAuth code exchange failed (HTTP {})",
                response.status()
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
    let account_id = account_id.to_owned();
    let token = token.to_owned();
    tokio::task::spawn_blocking(move || {
        keyring::Entry::new(KEYRING_SERVICE, &account_id)?.set_password(&token)
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
}
