import { useEffect, useState } from "react";
import type { NumberStyle } from "./annotationTypes";
import { numberBadgeDesign } from "./numberBadgeDesign";
import { loadNumberFont, measureNumberLabel } from "./numberBadgeFont";
import { numberBadgeGeometry } from "./numberBadgeGeometry";
import { formatSequence } from "./numberSequence";
import font from "./numberFont.json";
export function NumberBadgePreview({
  style,
  value = 1,
  size = 28,
}: {
  style: NumberStyle;
  value?: number;
  size?: number;
}) {
  const [fontLoaded, setFontLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void loadNumberFont().then(
      () => {
        if (active) setFontLoaded(true);
      },
      () => {
        // The placement layer reports preparation failures and supports retry.
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const design = numberBadgeDesign(style, value);
  const label = formatSequence(value, style.format);
  const geometry = fontLoaded
    ? numberBadgeGeometry({ x: size / 2, y: size / 2 }, size, 1, measureNumberLabel(label, size), {
        width: size,
        height: size,
      })
    : null;
  return (
    <svg
      width={size}
      height={size}
      viewBox={"0 0 " + size + " " + size}
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle cx={size / 2} cy={size / 2} r={size / 2} fill={design.fill} />
      <text
        x={size / 2}
        y={geometry ? geometry.textY + geometry.fontSize : size * 0.7}
        textAnchor="middle"
        fill={design.text}
        fontFamily={font.family}
        fontSize={geometry?.fontSize ?? size * 0.56}
      >
        {label}
      </text>
    </svg>
  );
}
