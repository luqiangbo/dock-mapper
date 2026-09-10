import type { ReactNode } from "react";
import {
  ARROW_EFFECT_OPTIONS,
  ARROW_STYLE_OPTIONS,
  ARROW_WIDTHS,
  type ArrowEffect,
  type ArrowPreset,
} from "./annotationTypes";
import { arrowOutlinePreview } from "./arrowShapes";

/**
 * Toolbar previews are vector copies of the real silhouette: they call the same
 * geometry layer the canvas fills, so a shape can never look different in the
 * picker than on the screenshot.
 */
function ArrowShapeThumb({ shape }: { shape: ArrowPreset }): React.JSX.Element {
  const preview = arrowOutlinePreview(shape);
  return (
    <svg
      className="arrow-thumb"
      viewBox={preview.viewBox}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <path d={preview.path} fill="currentColor" />
    </svg>
  );
}

function ArrowEffectThumb({ effect }: { effect: ArrowEffect }): React.JSX.Element {
  const preview = arrowOutlinePreview("straight");
  const id = `arrow-effect-swatch-${effect}`;
  return (
    <svg
      className="arrow-thumb"
      viewBox={preview.viewBox}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {effect === "gradient" && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.3" />
            <stop offset="1" stopColor="currentColor" />
          </linearGradient>
        </defs>
      )}
      {effect === "crayon" && (
        <defs>
          <pattern id={id} width="5" height="5" patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill="currentColor" opacity="0.5" />
            <circle cx="1.2" cy="1.2" r="1.2" fill="currentColor" />
            <circle cx="3.6" cy="3.4" r="0.9" fill="currentColor" />
          </pattern>
        </defs>
      )}
      {effect === "marker" && (
        <defs>
          <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="currentColor" opacity="0.42" />
            <rect width="6" height="1.8" fill="currentColor" opacity="0.78" />
          </pattern>
        </defs>
      )}
      <path d={preview.path} fill={effect === "classic" ? "currentColor" : `url(#${id})`} />
    </svg>
  );
}

/** A fixed view box keeps the three widths comparable at a glance. */
function ArrowWidthThumb({ width }: { width: number }): React.JSX.Element {
  // Long enough that no offered width is compressed by the short-arrow rule.
  const preview = arrowOutlinePreview("straight", 140, width);
  return (
    <svg
      className="arrow-thumb"
      viewBox="-4 -26 148 52"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <path d={preview.path} fill="currentColor" />
    </svg>
  );
}

export interface ArrowOption {
  value: string | number;
  label: ReactNode;
}

function option(value: string | number, thumb: ReactNode, text: string): ArrowOption {
  return {
    value,
    label: (
      <span className="arrow-option">
        {thumb}
        <span className="arrow-option__text">{text}</span>
      </span>
    ),
  };
}

export const ARROW_SHAPE_CHOICES: ArrowOption[] = ARROW_STYLE_OPTIONS.map((item) =>
  option(item.value, <ArrowShapeThumb shape={item.value} />, item.label),
);

export const ARROW_EFFECT_CHOICES: ArrowOption[] = ARROW_EFFECT_OPTIONS.map((item) =>
  option(item.value, <ArrowEffectThumb effect={item.value} />, item.label),
);

export const ARROW_WIDTH_CHOICES: ArrowOption[] = ARROW_WIDTHS.map((width) =>
  option(width, <ArrowWidthThumb width={width} />, `${width}px`),
);
