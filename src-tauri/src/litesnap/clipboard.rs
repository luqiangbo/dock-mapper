use arboard::{Clipboard, ImageData};
use std::borrow::Cow;

pub fn write_png(data: &[u8]) -> Result<(), String> {
    let rgba = image::load_from_memory(data)
        .map_err(|error| error.to_string())?
        .to_rgba8();
    let (width, height) = rgba.dimensions();
    Clipboard::new()
        .map_err(|error| error.to_string())?
        .set_image(ImageData {
            width: width as usize,
            height: height as usize,
            bytes: Cow::Owned(rgba.into_raw()),
        })
        .map_err(|error| error.to_string())
}

pub fn write_text(value: String) -> Result<(), String> {
    Clipboard::new()
        .map_err(|error| error.to_string())?
        .set_text(value)
        .map_err(|error| error.to_string())
}
