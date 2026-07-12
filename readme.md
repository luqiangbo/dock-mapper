# DockMapper

Windows 任务栏信息条与按键映射工具。

基于 Tauri 2.0 + Rsbuild + React + Semi Design 构建。

## 概览

双窗口架构：

- **主配置窗口** (`main`) — 管理按键映射规则、系统设置等，使用 Semi Design 提供现代化图形界面。
- **任务栏信息条** (`taskbar_widget`) — 嵌入 Windows 任务栏，实时显示网速、内存占用等信息。

## 开发

```bash
# 安装依赖
pnpm install

# 启动开发模式（前端 + Tauri）
pnpm tauri dev
```

## 构建

```bash
pnpm tauri build
```

## 自动更新

项目使用 `tauri-plugin-updater` 实现自动更新。如需发布新版本：

1. 确保已配置 `TAURI_PRIVATE_KEY` 环境变量（私钥）
2. 构建并签名：
   ```bash
   pnpm tauri build
   ```
3. 更新 `updater.json` 发布到 GitHub Releases

### 密钥管理

`plugins.updater.pubkey` 已在 `tauri.conf.json` 中配置。若需重新生成密钥对：

```bash
pnpm tauri signer generate
```

将生成的公钥填入 `tauri.conf.json` 的 `plugins.updater.pubkey`，私钥设置为环境变量 `TAURI_PRIVATE_KEY`。

## 技术栈

| 层级 | 技术 |
|------|------|
| 容器框架 | Tauri 2.0 (Rust) |
| 前端构建 | Rsbuild |
| 视图框架 | React 19 |
| UI 组件库 | Semi Design |
| 包管理 | pnpm |
| 系统 API | windows crate (Win32) |
| 按键捕获 | rdev |
| 系统监控 | sysinfo |
