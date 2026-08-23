# OCR model attribution

This directory bundles PP-OCRv6 small ONNX and MNN detection/recognition
models and the `ppocrv6_dict.txt` character dictionary distributed by RapidOCR.

Source: https://github.com/RapidAI/RapidOCR
Model release: `v3.9.2`

MNN file checksums (SHA-256):


The ONNX model is used by the embedded ONNX engine. The MNN model is used by
RustO 0.2.5. The files are bundled solely for local, offline OCR. They are
never downloaded at runtime and no screenshot is sent to a remote OCR service.
