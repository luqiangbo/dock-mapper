declare module "*.scss";
declare module "*.css";

declare module "*.png" {
  const source: string;
  export default source;
}

declare module "*.module.scss" {
  const classes: Record<string, string>;
  export default classes;
}

declare module "p5.brush/standalone" {
  export function add(name: string, options: Record<string, unknown>): void;
  export function load(canvas: HTMLCanvasElement | OffscreenCanvas): void;
  export function clear(color?: string): void;
  export function seed(value: number): void;
  export function noiseSeed(value: number): void;
  export function set(name: string, color: string, weight?: number): void;
  export function noStroke(): void;
  export function noFill(): void;
  export function noHatch(): void;
  export function noWash(): void;
  export function fill(color: string, opacity?: number): void;
  export function fillBleed(strength: number, direction?: "in" | "out", angle?: number): void;
  export function fillTexture(texture: number, border: number, scatter?: boolean): void;
  export function hatch(distance: number, angle: number, options?: Record<string, unknown>): void;
  export function hatchStyle(name: string, color: string, weight?: number): void;
  export function push(): void;
  export function pop(): void;
  export function translate(x: number, y: number): void;
  export function line(x1: number, y1: number, x2: number, y2: number): void;
  export function spline(points: Array<[number, number] | [number, number, number]>, curvature?: number): unknown;
  export function polygon(points: Array<[number, number]>): unknown;
  export function render(): void;
}
