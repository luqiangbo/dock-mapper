//! DockMapper 内置的双离线 OCR 引擎。
//!
//! 同一张选区 PNG 可分别交给 ONNX Runtime 与 RustO/MNN。两种模型都作为
//! Tauri 资源随应用发布，不下载模型、不依赖 Windows OCR 语言包或网络服务。

use crate::config::OcrEngine as SelectedOcrEngine;
use base64::{engine::general_purpose::STANDARD, Engine};
use paddleocr_rs_onnx::{OcrBlock, OcrEngine, OrderBy};
use rusto::{DetectTextResult, ImageSource, InitializeConfig, OcrRunOptions, RustO};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};

const MAX_IMAGE_EDGE: u32 = 2_048;
const ONNX_ENGINE_ID: &str = "onnx";
const RUSTO_ENGINE_ID: &str = "rusto";

static ONNX_ENGINE: OnceLock<Mutex<Option<OcrEngine>>> = OnceLock::new();
static RUSTO_ENGINE: OnceLock<Mutex<Option<RustO>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrTextResult {
    pub text: String,
    pub engine: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct QrDecodeResult {
    pub contents: Vec<String>,
}

#[derive(Debug, Clone)]
struct OnnxModelPaths {
    detection: PathBuf,
    recognition: PathBuf,
    charset: PathBuf,
}

#[derive(Debug, Clone)]
struct RustoModelPaths {
    detection: PathBuf,
    recognition: PathBuf,
    charset: PathBuf,
}

fn resource_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位内置 OCR 资源：{error}"))?;
    [
        resource_dir.join("ocr"),
        resource_dir.join("resources").join("ocr"),
    ]
    .into_iter()
    .find(|root| root.is_dir())
    .ok_or_else(|| "内置 OCR 模型缺失，请重新安装 DockMapper。".into())
}

fn onnx_model_paths(root: &Path) -> Result<OnnxModelPaths, String> {
    let paths = OnnxModelPaths {
        detection: root.join("PP-OCRv6_small_det.onnx"),
        recognition: root.join("PP-OCRv6_small_rec.onnx"),
        charset: root.join("ppocr_keys_v6_small.txt"),
    };
    if paths.detection.is_file() && paths.recognition.is_file() && paths.charset.is_file() {
        Ok(paths)
    } else {
        Err("ONNX OCR 模型缺失，请重新安装 DockMapper。".into())
    }
}

fn rusto_model_paths(root: &Path) -> Result<RustoModelPaths, String> {
    let paths = RustoModelPaths {
        detection: root.join("PP-OCRv6_small_det.mnn"),
        recognition: root.join("PP-OCRv6_small_rec.mnn"),
        charset: root.join("ppocr_keys_v6_small.txt"),
    };
    if paths.detection.is_file() && paths.recognition.is_file() && paths.charset.is_file() {
        Ok(paths)
    } else {
        Err("RustO MNN OCR 模型缺失，请重新安装 DockMapper。".into())
    }
}

fn onnx_engine(
    app: &AppHandle,
) -> Result<std::sync::MutexGuard<'static, Option<OcrEngine>>, String> {
    let mutex = ONNX_ENGINE.get_or_init(|| Mutex::new(None));
    let mut guard = mutex
        .lock()
        .map_err(|_| "ONNX OCR 引擎状态已损坏".to_string())?;
    if guard.is_none() {
        let paths = onnx_model_paths(&resource_dir(app)?)?;
        let detection = std::fs::read(paths.detection)
            .map_err(|error| format!("读取 ONNX OCR 检测模型失败：{error}"))?;
        let recognition = std::fs::read(paths.recognition)
            .map_err(|error| format!("读取 ONNX OCR 识别模型失败：{error}"))?;
        let charset = std::fs::read(paths.charset)
            .map_err(|error| format!("读取 ONNX OCR 字典失败：{error}"))?;
        *guard = Some(
            OcrEngine::new(&detection, &recognition, &charset)
                .map_err(|error| format!("初始化 ONNX OCR 失败：{error}"))?,
        );
    }
    Ok(guard)
}

fn rusto_engine(app: &AppHandle) -> Result<std::sync::MutexGuard<'static, Option<RustO>>, String> {
    let mutex = RUSTO_ENGINE.get_or_init(|| Mutex::new(None));
    let mut guard = mutex
        .lock()
        .map_err(|_| "RustO OCR 引擎状态已损坏".to_string())?;
    if guard.is_none() {
        let paths = rusto_model_paths(&resource_dir(app)?)?;
        *guard = Some(
            RustO::initialize(InitializeConfig::ppv6(
                paths.detection,
                paths.recognition,
                paths.charset,
            ))
            .map_err(|error| format!("初始化 RustO MNN OCR 失败：{error}"))?,
        );
    }
    Ok(guard)
}

fn decode_png(image_base64: &str) -> Result<Vec<u8>, String> {
    let png = STANDARD
        .decode(image_base64)
        .map_err(|_| "OCR 图片数据无效".to_string())?;
    if png.is_empty() {
        return Err("OCR 图片为空".into());
    }
    Ok(png)
}

fn resize_for_onnx(image: ocr_image::DynamicImage) -> ocr_image::DynamicImage {
    let longest = image.width().max(image.height());
    if longest <= MAX_IMAGE_EDGE {
        return image;
    }
    let scale = MAX_IMAGE_EDGE as f64 / longest as f64;
    image.resize(
        (image.width() as f64 * scale).round().max(1.0) as u32,
        (image.height() as f64 * scale).round().max(1.0) as u32,
        ocr_image::imageops::FilterType::Lanczos3,
    )
}

fn normalize_lines(lines: impl IntoIterator<Item = String>) -> String {
    lines
        .into_iter()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalized_block_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[derive(Clone)]
struct TextBlock {
    text: String,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

fn normalize_positioned_blocks(blocks: Vec<TextBlock>) -> String {
    let mut lines: Vec<Vec<TextBlock>> = Vec::new();
    for block in blocks
        .into_iter()
        .filter(|block| !block.text.trim().is_empty())
    {
        let center_y = block.y + block.height / 2.0;
        if let Some(line) = lines.last_mut() {
            let reference = &line[0];
            let reference_center = reference.y + reference.height / 2.0;
            let tolerance = reference.height.max(block.height) * 0.55;
            if (center_y - reference_center).abs() <= tolerance {
                line.push(block);
                continue;
            }
        }
        lines.push(vec![block]);
    }

    lines
        .into_iter()
        .map(|mut line| {
            line.sort_by(|left, right| left.x.total_cmp(&right.x));
            let mut text = String::new();
            for (index, block) in line.iter().enumerate() {
                let value = normalized_block_text(&block.text);
                if value.is_empty() {
                    continue;
                }
                if index > 0 {
                    let previous = &line[index - 1];
                    let character_width =
                        previous.width / previous.text.chars().count().max(1) as f32;
                    let gap = block.x - (previous.x + previous.width);
                    if gap > character_width * 0.35 {
                        text.push(' ');
                    }
                }
                text.push_str(&value);
            }
            text.trim().to_owned()
        })
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_onnx_blocks(blocks: Vec<OcrBlock>) -> String {
    normalize_positioned_blocks(
        blocks
            .into_iter()
            .map(|block| TextBlock {
                text: block.text,
                x: block.x,
                y: block.y,
                width: block.width,
                height: block.height,
            })
            .collect(),
    )
}

pub fn recognize_onnx(app: &AppHandle, image_base64: &str) -> Result<OcrTextResult, String> {
    let png = decode_png(image_base64)?;
    let image = ocr_image::load_from_memory(&png)
        .map_err(|error| format!("读取 ONNX OCR 图片失败：{error}"))?;
    let image = resize_for_onnx(image);
    let guard = onnx_engine(app)?;
    let results = guard
        .as_ref()
        .expect("ONNX OCR engine initialized")
        .recognize_all(&image, OrderBy::Horizontal)
        .map_err(|error| format!("ONNX OCR 识别失败：{error}"))?;
    Ok(OcrTextResult {
        text: normalize_onnx_blocks(results),
        engine: ONNX_ENGINE_ID.into(),
    })
}

pub fn recognize_rusto(app: &AppHandle, image_base64: &str) -> Result<OcrTextResult, String> {
    let png = decode_png(image_base64)?;
    let mut guard = rusto_engine(app)?;
    let result = guard
        .as_mut()
        .expect("RustO OCR engine initialized")
        .detect_text(&ImageSource::Bytes(png), &OcrRunOptions::default())
        .map_err(|error| format!("RustO MNN OCR 识别失败：{error}"))?;
    let text = match result {
        DetectTextResult::Structured(results) => normalize_positioned_blocks(
            results
                .into_iter()
                .map(|item| TextBlock {
                    text: item.text,
                    x: item.frame.left,
                    y: item.frame.top,
                    width: item.frame.width,
                    height: item.frame.height,
                })
                .collect(),
        ),
        DetectTextResult::Spatial(text) => normalize_lines(text.lines().map(normalized_block_text)),
    };
    Ok(OcrTextResult {
        text,
        engine: RUSTO_ENGINE_ID.into(),
    })
}

pub fn recognize(
    app: &AppHandle,
    image_base64: &str,
    engine: SelectedOcrEngine,
) -> Result<OcrTextResult, String> {
    match engine {
        SelectedOcrEngine::Onnx => recognize_onnx(app, image_base64),
        SelectedOcrEngine::Rusto => recognize_rusto(app, image_base64),
    }
}

pub fn decode_qr(image_base64: &str) -> Result<QrDecodeResult, String> {
    let png = decode_png(image_base64)?;
    let image = ocr_image::load_from_memory(&png)
        .map_err(|error| format!("读取二维码图片失败：{error}"))?
        .to_luma8();
    let mut decoder = quircs::Quirc::default();
    let codes = decoder.identify(
        image.width() as usize,
        image.height() as usize,
        image.as_raw(),
    );
    let mut contents = Vec::new();
    for code in codes.flatten() {
        let decoded = code
            .decode()
            .map_err(|error| format!("二维码解码失败：{error}"))?;
        let value = String::from_utf8_lossy(&decoded.payload).trim().to_owned();
        if !value.is_empty() && !contents.contains(&value) {
            contents.push(value);
        }
    }
    Ok(QrDecodeResult { contents })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_text_without_losing_line_breaks() {
        assert_eq!(
            normalize_lines([" first ".into(), "".into(), "second ".into()]),
            "first\nsecond"
        );
    }

    #[test]
    fn preserves_chinese_but_normalizes_whitespace() {
        assert_eq!(
            normalized_block_text(" DockMapper\t截图 "),
            "DockMapper 截图"
        );
    }

    #[test]
    fn reports_missing_models_per_engine() {
        let root = Path::new("this-directory-does-not-exist");
        assert!(onnx_model_paths(root).is_err());
        assert!(rusto_model_paths(root).is_err());
    }

    #[test]
    fn bundled_onnx_models_initialize() {
        let engine = OcrEngine::new(
            include_bytes!("../resources/ocr/PP-OCRv6_small_det.onnx"),
            include_bytes!("../resources/ocr/PP-OCRv6_small_rec.onnx"),
            include_bytes!("../resources/ocr/ppocr_keys_v6_small.txt"),
        );
        assert!(engine.is_ok(), "bundled ONNX model must load");
    }

    #[test]
    fn bundled_rusto_models_initialize() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/ocr");
        let paths = rusto_model_paths(&root).expect("bundled RustO models should exist");
        let engine = RustO::initialize(InitializeConfig::ppv6(
            paths.detection,
            paths.recognition,
            paths.charset,
        ));
        assert!(engine.is_ok(), "bundled RustO MNN model must load");
    }
}
