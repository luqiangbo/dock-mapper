declare module "*.scss";
declare const __DOCKMAPPER_BUILD__: Readonly<{ releaseVersion: string; commit: string }>;
declare module "*.css";

declare module "*.png" {
  const source: string;
  export default source;
}

declare module "*.module.scss" {
  const classes: Record<string, string>;
  export default classes;
}
