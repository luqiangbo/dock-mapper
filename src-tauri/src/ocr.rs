//! DockMapper 内置的 ONNX 离线 OCR 服务。

use paddleocr_rs_onnx::{OcrEngine, OrderBy};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        mpsc::{self, RecvTimeoutError, SyncSender},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;

const MAX_IMAGE_EDGE: u32 = 2_048;
const MIN_RESIZED_EDGE: u32 = 96;
const ENGINE_ID: &str = "onnx";
const OCR_QUEUE_CAPACITY: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrTextResult {
    pub text: String,
    pub engine: String,
    pub blocks: Vec<OcrTextBlock>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrTextBlock {
    pub text: String,
    pub confidence: f32,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

fn scaled_text_block(
    text: String,
    confidence: f32,
    bounds: (f32, f32, f32, f32),
    scale: (f32, f32),
) -> OcrTextBlock {
    OcrTextBlock {
        text,
        confidence,
        x: bounds.0 * scale.0,
        y: bounds.1 * scale.1,
        width: bounds.2 * scale.0,
        height: bounds.3 * scale.1,
    }
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

fn validate_png(png: Vec<u8>) -> Result<Vec<u8>, String> {
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
    if (image.width().min(image.height()) as f64 * scale).round() < MIN_RESIZED_EDGE as f64 {
        return image;
    }
    image.resize(
        (image.width() as f64 * scale).round().max(1.0) as u32,
        (image.height() as f64 * scale).round().max(1.0) as u32,
        ocr_image::imageops::FilterType::Lanczos3,
    )
}

#[cfg(test)]
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
    let mut blocks = blocks;
    blocks.sort_by(|left, right| {
        let left_center = left.y + left.height / 2.0;
        let right_center = right.y + right.height / 2.0;
        left_center
            .total_cmp(&right_center)
            .then_with(|| left.x.total_cmp(&right.x))
    });
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

fn load_engine(root: &Path) -> Result<OcrEngine, String> {
    let paths = onnx_model_paths(root)?;
    let detection = std::fs::read(paths.detection)
        .map_err(|error| format!("读取 ONNX OCR 检测模型失败：{error}"))?;
    let recognition = std::fs::read(paths.recognition)
        .map_err(|error| format!("读取 ONNX OCR 识别模型失败：{error}"))?;
    let charset =
        std::fs::read(paths.charset).map_err(|error| format!("读取 ONNX OCR 字典失败：{error}"))?;
    OcrEngine::new(&detection, &recognition, &charset)
        .map_err(|error| format!("初始化 ONNX OCR 失败：{error}"))
}

fn recognize_with_engine(engine: &mut OcrEngine, png: Vec<u8>) -> Result<OcrTextResult, String> {
    let png = validate_png(png)?;
    let started = Instant::now();
    let decode_started = Instant::now();
    let image = ocr_image::load_from_memory(&png)
        .map_err(|error| format!("读取 ONNX OCR 图片失败：{error}"))?;
    let original_width = image.width();
    let original_height = image.height();
    let decode_ms = decode_started.elapsed().as_millis();
    let resize_started = Instant::now();
    let image = resize_for_onnx(image);
    let resize_ms = resize_started.elapsed().as_millis();
    let inference_started = Instant::now();
    let results = engine
        .recognize_all(&image, OrderBy::Horizontal)
        .map_err(|error| format!("ONNX OCR 识别失败：{error}"))?;
    let inference_ms = inference_started.elapsed().as_millis();
    let postprocess_started = Instant::now();
    let scale_x = original_width as f32 / image.width().max(1) as f32;
    let scale_y = original_height as f32 / image.height().max(1) as f32;
    let blocks = results
        .into_iter()
        .filter_map(|block| {
            let text = normalized_block_text(&block.text);
            (!text.is_empty()).then_some(scaled_text_block(
                text,
                block.confidence,
                (block.x, block.y, block.width, block.height),
                (scale_x, scale_y),
            ))
        })
        .collect::<Vec<_>>();
    let text = normalize_positioned_blocks(
        blocks
            .iter()
            .map(|block| TextBlock {
                text: block.text.clone(),
                x: block.x,
                y: block.y,
                width: block.width,
                height: block.height,
            })
            .collect(),
    );
    let postprocess_ms = postprocess_started.elapsed().as_millis();
    tracing::info!(
        target: "dock_mapper::ocr",
        decode_ms,
        resize_ms,
        inference_ms,
        postprocess_ms,
        total_ms = started.elapsed().as_millis(),
        width = image.width(),
        height = image.height(),
        "OCR recognition completed"
    );
    Ok(OcrTextResult {
        text,
        engine: ENGINE_ID.into(),
        blocks,
    })
}

struct OcrJob {
    generation: u64,
    png: Vec<u8>,
    reply: oneshot::Sender<Result<OcrTextResult, String>>,
}

pub struct OcrService {
    sender: SyncSender<OcrJob>,
    generation: Arc<AtomicU64>,
    queued: Arc<AtomicUsize>,
}

impl OcrService {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let root = resource_dir(app)?;
        let (sender, receiver) = mpsc::sync_channel::<OcrJob>(OCR_QUEUE_CAPACITY);
        let generation = Arc::new(AtomicU64::new(0));
        let worker_generation = generation.clone();
        let queued = Arc::new(AtomicUsize::new(0));
        let worker_queued = queued.clone();
        thread::Builder::new()
            .name("dockmapper-ocr".into())
            .spawn(move || {
                let mut engine: Option<Result<OcrEngine, String>> = None;
                loop {
                    let job = match receiver.recv_timeout(Duration::from_secs(2)) {
                        Ok(job) => job,
                        Err(RecvTimeoutError::Timeout) => {
                            if engine.is_none() {
                                let initialized = Instant::now();
                                engine = Some(load_engine(&root));
                                tracing::info!(
                                    target: "dock_mapper::ocr",
                                    elapsed_ms = initialized.elapsed().as_millis(),
                                    success = engine.as_ref().is_some_and(Result::is_ok),
                                    "OCR engine idle prewarm finished"
                                );
                            }
                            continue;
                        }
                        Err(RecvTimeoutError::Disconnected) => break,
                    };
                    worker_queued.fetch_sub(1, Ordering::AcqRel);
                    let span = tracing::info_span!(
                        target: "dock_mapper::ocr",
                        "ocr_job",
                        generation = job.generation
                    );
                    let _entered = span.enter();
                    if worker_generation.load(Ordering::Acquire) != job.generation {
                        let _ = job.reply.send(Err("OCR 请求已取消".into()));
                        continue;
                    }
                    if engine.is_none() {
                        let initialized = Instant::now();
                        engine = Some(load_engine(&root));
                        tracing::info!(
                            target: "dock_mapper::ocr",
                            elapsed_ms = initialized.elapsed().as_millis(),
                            success = engine.as_ref().is_some_and(Result::is_ok),
                            "OCR engine initialized on demand"
                        );
                    }
                    let result = match engine.as_mut() {
                        Some(Ok(engine)) => recognize_with_engine(engine, job.png),
                        Some(Err(error)) => Err(error.clone()),
                        None => Err("OCR 引擎状态异常".into()),
                    };
                    if worker_generation.load(Ordering::Acquire) == job.generation {
                        let _ = job.reply.send(result);
                    } else {
                        let _ = job.reply.send(Err("OCR 请求已取消".into()));
                    }
                }
            })
            .map_err(|error| format!("创建 OCR 工作线程失败：{error}"))?;
        Ok(Self {
            sender,
            generation,
            queued,
        })
    }

    pub async fn recognize(&self, png: Vec<u8>) -> Result<OcrTextResult, String> {
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        let (reply, response) = oneshot::channel();
        self.queued.fetch_add(1, Ordering::AcqRel);
        if let Err(error) = self.sender.try_send(OcrJob {
            generation,
            png,
            reply,
        }) {
            self.queued.fetch_sub(1, Ordering::AcqRel);
            return Err(match error {
                mpsc::TrySendError::Full(_) => "OCR 队列繁忙，请稍后重试".to_string(),
                mpsc::TrySendError::Disconnected(_) => "OCR 工作线程已停止".to_string(),
            });
        }
        tracing::debug!(
            target: "dock_mapper::ocr",
            generation,
            queue_length = self.queued.load(Ordering::Acquire),
            "OCR request queued"
        );
        response
            .await
            .map_err(|_| "OCR 工作线程已停止".to_string())?
    }

    pub fn cancel(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
    }
}

pub fn decode_qr(png: Vec<u8>) -> Result<QrDecodeResult, String> {
    let png = validate_png(png)?;
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
    }

    #[test]
    #[ignore = "model initialization is intentionally excluded from daily tests"]
    fn model_bundled_onnx_models_initialize() {
        let engine = OcrEngine::new(
            include_bytes!("../resources/ocr/PP-OCRv6_small_det.onnx"),
            include_bytes!("../resources/ocr/PP-OCRv6_small_rec.onnx"),
            include_bytes!("../resources/ocr/ppocr_keys_v6_small.txt"),
        );
        assert!(engine.is_ok(), "bundled ONNX model must load");
    }

    #[test]
    #[ignore = "model benchmark is intentionally excluded from daily tests"]
    fn model_benchmark_reports_warm_inference_time() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/ocr");
        let mut engine = load_engine(&root).expect("bundled ONNX model");
        let image = ocr_image::DynamicImage::new_rgb8(640, 240);
        let mut png = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut png, ocr_image::ImageFormat::Png)
            .expect("encode fixture");
        let started = Instant::now();
        let _ = recognize_with_engine(&mut engine, png.into_inner()).expect("benchmark OCR");
        eprintln!("warm OCR benchmark: {} ms", started.elapsed().as_millis());
    }

    #[test]
    fn sorts_positioned_blocks_before_line_clustering() {
        let text = normalize_positioned_blocks(vec![
            TextBlock {
                text: "second".into(),
                x: 0.0,
                y: 30.0,
                width: 30.0,
                height: 10.0,
            },
            TextBlock {
                text: "world".into(),
                x: 35.0,
                y: 0.0,
                width: 30.0,
                height: 10.0,
            },
            TextBlock {
                text: "hello".into(),
                x: 0.0,
                y: 0.0,
                width: 30.0,
                height: 10.0,
            },
        ]);
        assert_eq!(text, "hello world\nsecond");
    }

    #[test]
    fn keeps_thin_high_dpi_selections_at_their_original_scale() {
        let image = ocr_image::DynamicImage::new_rgb8(4_096, 120);
        let resized = resize_for_onnx(image);
        assert_eq!((resized.width(), resized.height()), (4_096, 120));
    }

    #[test]
    fn maps_ocr_block_coordinates_back_to_the_original_selection() {
        let block = scaled_text_block(
            "DockMapper".into(),
            0.98,
            (10.0, 20.0, 30.0, 8.0),
            (2.0, 1.5),
        );
        assert_eq!(
            (block.x, block.y, block.width, block.height),
            (20.0, 30.0, 60.0, 12.0)
        );
        assert_eq!(block.text, "DockMapper");
    }
}
