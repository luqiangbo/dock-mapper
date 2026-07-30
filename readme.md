# DockMapper

Windows 任务栏信息条与按键映射工具。

基于 Tauri 2 + Rsbuild + React 19 + Semi Design 构建，支持 Windows 10/11 x64。

## 概览

双窗口架构：

- **主配置窗口** (`main`) — 管理按键映射规则、挂件和系统设置；Windows 11 使用 Mica，Windows 10 自动使用稳定材质降级。
- **任务栏信息条** (`taskbar_widget`) — 嵌入主任务栏，实时显示网速和内存占用。
- **按键映射引擎** — 使用原生 `WH_KEYBOARD_LL + SendInput`，忽略注入事件并在退出时卸载钩子。

## 开发

```bash
# 安装依赖
pnpm install

# 启动开发模式（前端 + Tauri）
pnpm tauri dev
```

## 构建

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm tauri build
```

## 发布

三处版本由统一命令同步：

```powershell
pnpm version:sync 1.0.6
```

GitHub Actions 会依次校验、构建 Draft Release、验证签名、正式发布，再独立提交
Winget 更新。完整流程见 [发布与 Winget 指南](docs/winget-publish-guide.md)。

## 技术栈

| 层级 | 技术 |
|------|------|
| 容器框架 | Tauri 2 (Rust) |
| 前端构建 | Rsbuild |
| 视图框架 | React 19 |
| UI 组件库 | Semi Design |
| 包管理 | pnpm |
| 系统 API | windows crate (Win32) |
| 按键捕获 | Windows `WH_KEYBOARD_LL` / `SendInput` |
| 系统监控 | sysinfo |
