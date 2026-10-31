use super::*;
use windows::Win32::{Graphics::Gdi::*, UI::WindowsAndMessaging::*};

#[derive(Clone)]
pub(super) struct CursorCapture {
    pub png: Arc<[u8]>,
    pub sample_x: i32,
    pub sample_y: i32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

unsafe fn render(icon: HICON, width: u32, height: u32, background: u8) -> Result<Vec<u8>, String> {
    unsafe {
        let screen = GetDC(None);
        let memory = CreateCompatibleDC(Some(screen));
        if memory.0.is_null() {
            let _ = ReleaseDC(None, screen);
            return Err("鼠标图像画布不可用".into());
        }
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = std::ptr::null_mut();
        let bitmap =
            match CreateDIBSection(Some(memory), &info, DIB_RGB_COLORS, &mut pixels, None, 0) {
                Ok(value) => value,
                Err(error) => {
                    let _ = DeleteDC(memory);
                    let _ = ReleaseDC(None, screen);
                    return Err(error.to_string());
                }
            };
        let old = SelectObject(memory, HGDIOBJ(bitmap.0));
        let size = width as usize * height as usize * 4;
        std::ptr::write_bytes(pixels, background, size);
        let drawn = DrawIconEx(
            memory,
            0,
            0,
            icon,
            width as i32,
            height as i32,
            0,
            None,
            DI_NORMAL,
        )
        .map_err(|e| e.to_string());
        let bytes = std::slice::from_raw_parts(pixels.cast::<u8>(), size).to_vec();
        let _ = SelectObject(memory, old);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory);
        let _ = ReleaseDC(None, screen);
        drawn.map(|_| bytes)
    }
}

pub(super) fn capture(origin_x: i32, origin_y: i32) -> Result<Option<CursorCapture>, String> {
    unsafe {
        let mut cursor = CURSORINFO {
            cbSize: size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };
        GetCursorInfo(&mut cursor).map_err(|e| e.to_string())?;
        if cursor.flags != CURSOR_SHOWING {
            return Ok(None);
        }
        let icon = CopyIcon(HICON(cursor.hCursor.0)).map_err(|e| e.to_string())?;
        let result = (|| {
            let mut info = ICONINFO::default();
            GetIconInfo(icon, &mut info).map_err(|e| e.to_string())?;
            let mut bitmap = BITMAP::default();
            let handle = if !info.hbmColor.0.is_null() {
                info.hbmColor
            } else {
                info.hbmMask
            };
            let obtained = GetObjectW(
                HGDIOBJ(handle.0),
                size_of::<BITMAP>() as i32,
                Some((&mut bitmap as *mut BITMAP).cast()),
            );
            let width = bitmap.bmWidth.max(1) as u32;
            let height = (if info.hbmColor.0.is_null() {
                bitmap.bmHeight / 2
            } else {
                bitmap.bmHeight
            })
            .max(1) as u32;
            let _ = DeleteObject(HGDIOBJ(info.hbmColor.0));
            let _ = DeleteObject(HGDIOBJ(info.hbmMask.0));
            if obtained == 0 || width > 256 || height > 256 {
                return Err("鼠标图像尺寸无效".into());
            }
            let black = render(icon, width, height, 0)?;
            let white = render(icon, width, height, 255)?;
            let mut rgba = vec![0; black.len()];
            for ((out, b), w) in rgba
                .chunks_exact_mut(4)
                .zip(black.chunks_exact(4))
                .zip(white.chunks_exact(4))
            {
                let alpha = 255_u16.saturating_sub((w[0] as u16).saturating_sub(b[0] as u16));
                for (dest, source) in [(0, 2), (1, 1), (2, 0)] {
                    out[dest] = if alpha == 0 {
                        0
                    } else {
                        ((b[source] as u16 * 255) / alpha).min(255) as u8
                    };
                }
                out[3] = alpha as u8;
            }
            let image =
                image::RgbaImage::from_raw(width, height, rgba).ok_or("鼠标图像缓冲区无效")?;
            let mut png = Cursor::new(Vec::new());
            image::DynamicImage::ImageRgba8(image)
                .write_to(&mut png, image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;
            Ok(Some(CursorCapture {
                sample_x: cursor.ptScreenPos.x - origin_x,
                sample_y: cursor.ptScreenPos.y - origin_y,
                png: png.into_inner().into(),
                x: cursor.ptScreenPos.x - origin_x - info.xHotspot as i32,
                y: cursor.ptScreenPos.y - origin_y - info.yHotspot as i32,
                width,
                height,
            }))
        })();
        let _ = DestroyIcon(icon);
        result
    }
}
