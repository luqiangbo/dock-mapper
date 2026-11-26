use arboard::{Clipboard, ImageData};
use std::{borrow::Cow, thread, time::Duration};

const CLIPBOARD_RETRY_ATTEMPTS: usize = 5;
const CLIPBOARD_RETRY_DELAY: Duration = Duration::from_millis(40);

fn with_clipboard_retry<T>(
    attempts: usize,
    delay: Duration,
    mut operation: impl FnMut() -> Result<T, String>,
) -> Result<T, String> {
    let total = attempts.max(1);
    let mut last_error = String::new();
    for attempt in 0..total {
        match operation() {
            Ok(value) => return Ok(value),
            Err(error) => {
                last_error = error;
                if attempt + 1 < total && !delay.is_zero() {
                    thread::sleep(delay);
                }
            }
        }
    }
    Err(last_error)
}

pub fn write_png(data: &[u8]) -> Result<(), String> {
    let rgba = image::load_from_memory(data)
        .map_err(|error| error.to_string())?
        .to_rgba8();
    let (width, height) = rgba.dimensions();
    let raw = rgba.into_raw();
    with_clipboard_retry(CLIPBOARD_RETRY_ATTEMPTS, CLIPBOARD_RETRY_DELAY, || {
        Clipboard::new()
            .map_err(|error| error.to_string())?
            .set_image(ImageData {
                width: width as usize,
                height: height as usize,
                bytes: Cow::Borrowed(raw.as_slice()),
            })
            .map_err(|error| error.to_string())
    })
}

pub fn write_text(value: String) -> Result<(), String> {
    with_clipboard_retry(CLIPBOARD_RETRY_ATTEMPTS, CLIPBOARD_RETRY_DELAY, || {
        Clipboard::new()
            .map_err(|error| error.to_string())?
            .set_text(value.as_str())
            .map_err(|error| error.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_transient_clipboard_lock_until_success() {
        let mut tries = 0;
        let result = with_clipboard_retry(4, Duration::ZERO, || {
            tries += 1;
            if tries < 3 {
                Err("clipboard busy".into())
            } else {
                Ok("copied")
            }
        });
        assert_eq!(result.unwrap(), "copied");
        assert_eq!(tries, 3);
    }

    #[test]
    fn returns_last_error_when_clipboard_remains_locked() {
        let mut tries = 0;
        let result = with_clipboard_retry(3, Duration::ZERO, || {
            tries += 1;
            Err::<(), String>(format!("locked-{tries}"))
        });
        assert_eq!(result.unwrap_err(), "locked-3");
        assert_eq!(tries, 3);
    }
}
