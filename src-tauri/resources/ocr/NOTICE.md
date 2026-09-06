# OCR model attribution

This directory bundles PP-OCRv6 small ONNX detection/recognition models and
their character dictionary for the embedded local ONNX engine.

Distribution: RapidAI/RapidOCR model release `v3.9.2`.
[Official model manifest](https://github.com/RapidAI/RapidOCR/blob/main/python/rapidocr/default_models.yaml).

| Bundled file | Upstream name | SHA-256 |
| --- | --- | --- |
| `PP-OCRv6_small_det.onnx` | `PP-OCRv6_det_small.onnx` | `090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f` |
| `PP-OCRv6_small_rec.onnx` | `PP-OCRv6_rec_small.onnx` | `6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884` |
| `ppocr_keys_v6_small.txt` | `ppocrv6_dict.txt` | `b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d` |

Verified on 2026-09-05: both ONNX checksums match the official manifest;
the dictionary is byte-identical to the [upstream small-model dictionary](https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/paddle/PP-OCRv6/rec/PP-OCRv6_rec_small/ppocrv6_dict.txt).
This verifies resource identity, not inference accuracy or runtime initialization.

The files are bundled solely for offline OCR. No model is downloaded at runtime
and no screenshot is sent to a remote OCR service. No MNN model is bundled.
