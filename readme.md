# DockMapper

Windows 11 任务栏信息条、系统级按键映射与截图工具。

基于 Tauri 2 + Rsbuild + React 19 + Ant Design 构建，仅支持 Windows 11 x64。

## 概览

双窗口架构：

- **主配置窗口** (`main`) — 管理按键映射规则、挂件、截图和系统设置；使用 Windows 11 Mica 材质。
- **任务栏信息条** (`taskbar_widget`) — 嵌入主任务栏，实时显示网速和内存占用。
- **按键映射** — 使用 Windows `Scancode Map` 系统扫描码映射；管理员写入后在下次登录或重启生效，不依赖常驻键盘钩子。
- **截图** — 基于 LiteSnap 的 Tauri 工作流，支持全局快捷键、区域选择、标注、滚动长截图、复制、保存与屏幕置顶。

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
| UI 组件库 | Ant Design |
| 包管理 | pnpm |
| 系统 API | windows crate (Win32) |
| 按键映射 | Windows `Scancode Map` 注册表 |
| 截图 | `screenshots` + `arboard` + 全局快捷键 |
| 系统监控 | sysinfo |
