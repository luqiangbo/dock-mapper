import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QrResultOverlay, type QrResultOverlayProps } from "./QrResultOverlay";
import { qrResultPosition } from "./qrResultPosition";

const props: QrResultOverlayProps = {
  bounds: { x: 24, y: 36, width: 480, height: 240 },
  result: { contents: [], codes: [], width: 960, height: 480 },
  pending: false,
  error: "",
  onClose: vi.fn(),
  onRetry: vi.fn(),
  copy: vi.fn(),
};
describe("每个二维码中心的简洁结果", () => {
  it("多码分别定位，相同内容不合并，只显示文案和复制按钮", () => {
    const result = {
      ...props.result,
      contents: ["https://example.com"],
      codes: [
        { content: "https://example.com", centerX: 240, centerY: 240 },
        { content: "https://example.com", centerX: 720, centerY: 240 },
      ],
    };
    const html = renderToStaticMarkup(<QrResultOverlay {...props} result={result} />);
    expect(html).toContain("left:120px;top:120px;width:220px");
    expect(html).toContain("left:360px;top:120px;width:220px");
    expect(html.match(/>复制</g)).toHaveLength(2);
    expect(html).not.toContain("打开链接");
    expect(html).not.toContain("ant-card");
    expect(html).not.toContain("textarea");
    expect(html).toContain('title="https://example.com"');
  });
  it("物理像素映射到显示坐标，边缘浮层不超出选区", () => {
    const center = qrResultPosition({ centerX: 480, centerY: 240 }, props.result, props.bounds);
    expect(center).toEqual({ left: 240, top: 120, width: 220 });
    const edge = qrResultPosition({ centerX: 0, centerY: 0 }, props.result, props.bounds);
    expect(edge.left - edge.width / 2).toBeGreaterThanOrEqual(0);
    expect(edge.top).toBeGreaterThanOrEqual(34);
  });
  it("加载、空状态和错误仍在选区内简洁呈现", () => {
    const pending = renderToStaticMarkup(<QrResultOverlay {...props} pending />);
    expect(pending).toContain("正在识别二维码");
    expect(pending).not.toContain("未发现二维码");
    const empty = renderToStaticMarkup(<QrResultOverlay {...props} />);
    expect(empty).toContain("未发现二维码");
    const failed = renderToStaticMarkup(<QrResultOverlay {...props} error="识别失败" />);
    expect(failed).toContain("识别失败");
    expect(failed).toContain("重试");
  });
});
