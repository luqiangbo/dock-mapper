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
