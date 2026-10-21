//! Background images picked from the file system, copied into the app data
//! directory so the preference keeps working if the original file moves.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// Preference prefix for an image stored by [`save`].
pub const LOCAL_PREFIX: &str = "local:";
pub const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;
const EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"];

pub fn directory(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Internal(error.to_string()))?;
    Ok(dir.join("backgrounds"))
}

/// Accepts only names [`save`] generates, so a name can never escape the directory.
pub fn is_stored_name(name: &str) -> bool {
    let Some((stem, extension)) = name.rsplit_once('.') else {
        return false;
    };
    uuid::Uuid::parse_str(stem).is_ok_and(|id| id.hyphenated().to_string() == stem)
        && EXTENSIONS.contains(&extension)
}

/// A background preference is empty, an http(s) URL, or a stored image.
pub fn is_valid_preference(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    if let Some(name) = value.strip_prefix(LOCAL_PREFIX) {
        return is_stored_name(name);
    }
    url::Url::parse(value)
        .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host().is_some())
}

pub fn stored_name(preference: &str) -> Option<&str> {
    preference.strip_prefix(LOCAL_PREFIX)
}

pub fn save(dir: &Path, bytes: &[u8], extension: &str) -> AppResult<String> {
    let extension = extension.trim_start_matches('.').to_ascii_lowercase();
    if !EXTENSIONS.contains(&extension.as_str()) {
        return Err(AppError::Validation(format!(
            "background images must be one of: {}",
            EXTENSIONS.join(", ")
        )));
    }
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err(AppError::Validation(format!(
            "background images must be between 1 byte and {} MB",
            MAX_IMAGE_BYTES / 1024 / 1024
        )));
    }
    std::fs::create_dir_all(dir)?;
    let name = format!("{}.{extension}", uuid::Uuid::new_v4());
    std::fs::write(dir.join(&name), bytes)?;
    Ok(name)
}

pub fn read(dir: &Path, name: &str) -> AppResult<Vec<u8>> {
    if !is_stored_name(name) {
        return Err(AppError::Validation("invalid background image name".into()));
    }
    std::fs::read(dir.join(name)).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => AppError::NotFound("background image".into()),
        _ => error.into(),
    })
}

/// Deletes stored images other than `keep`.
pub fn prune(dir: &Path, keep: &[&str]) -> AppResult<()> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if is_stored_name(name) && !keep.contains(&name) {
            std::fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_background_preferences() {
        assert!(is_valid_preference(""));
        assert!(is_valid_preference("https://example.com/sky.jpg"));
        assert!(is_valid_preference("http://example.com/sky.jpg"));
        assert!(is_valid_preference(
            "local:0d5f3a8e-1c2b-4c1e-9b7a-2f6e8d4c3b1a.png"
        ));
        assert!(!is_valid_preference("file:///etc/passwd"));
        assert!(!is_valid_preference("javascript:alert(1)"));
        assert!(!is_valid_preference("local:../calendar.sqlite3"));
        assert!(!is_valid_preference(
            "local:0d5f3a8e-1c2b-4c1e-9b7a-2f6e8d4c3b1a.svg"
        ));
    }

    #[test]
    fn saves_reads_and_prunes_images() {
        let dir = std::env::temp_dir().join(format!("clay-bg-{}", uuid::Uuid::new_v4()));
        let first = save(&dir, b"one", "PNG").unwrap();
        let second = save(&dir, b"two", ".jpg").unwrap();
        assert!(first.ends_with(".png") && second.ends_with(".jpg"));
        assert_eq!(read(&dir, &second).unwrap(), b"two");
        assert!(save(&dir, b"three", "svg").is_err());
        assert!(save(&dir, b"", "png").is_err());

        prune(&dir, &[second.as_str()]).unwrap();
        assert!(matches!(read(&dir, &first), Err(AppError::NotFound(_))));
        assert!(read(&dir, &second).is_ok());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
