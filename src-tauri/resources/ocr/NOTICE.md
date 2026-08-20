# OCR model attribution

This directory bundles PP-OCRv6 small ONNX and MNN detection/recognition
models and the `ppocrv6_dict.txt` character dictionary distributed by RapidOCR.

Source: https://github.com/RapidAI/RapidOCR
Model release: `v3.9.2`

MNN file checksums (SHA-256):

- `PP-OCRv6_small_det.mnn`: `a41bcf051c24b67c46172005915f8b8f6a0272cb30b11bf9f16cca4231d21ee1`
- `PP-OCRv6_small_rec.mnn`: `3ed704bdc5495002225237444384437617777bd962fa048d5d09d1444b98564b`

The ONNX model is used by the embedded ONNX engine. The MNN model is used by
RustO 0.2.5. The files are bundled solely for local, offline OCR. They are
never downloaded at runtime and no screenshot is sent to a remote OCR service.
