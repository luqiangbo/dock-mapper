# DockMapper 技术概览

本文面向参与开发、维护或发布 DockMapper 的人员；产品能力与快捷键请见项目根目录的 [README](../readme.md)。

## 平台与技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面容器 | Tauri 2 / Rust |
| 前端 | Rsbuild / React 19 / TypeScript / Ant Design |
| 图表 | Apache ECharts 6，按需引入并使用 SVG Renderer |
| 系统 API | `windows` crate、`sysinfo`、Windows Raw Input |
| 截图 | DXGI / 原生 GDI、`arboard`、全局快捷键 |
| 识别 | ONNX PP-OCRv6 small、quircs |
| 日志 | tracing + tracing-subscriber |

目标平台固定为 Windows 11 x64。包管理器使用 pnpm，所有图片与 OCR 数据默认只在本机处理。

## 运行架构

DockMapper 使用职责独立的 Tauri WebView，并由单实例入口统一管理：重复启动时仅恢复并聚焦已有主窗口，不重复创建托盘、快捷键或挂件。

| 部分 | 窗口或模块 | 职责 |
| --- | --- | --- |
| 主窗口 | `main` | 管理按键映射、仪表盘、挂件、截图和系统设置；使用 Windows 11 Mica 材质。 |
| 任务栏挂件 | `taskbar_widget` | 嵌入主任务栏，组合系统指标；只在尺寸或位置实际变化时重设几何信息。 |
| 按键文本 | `key_visualizer` | 透明、置顶、鼠标穿透的最近按键展示；仅接收过滤后的文本事件。 |
| 演示辅助 | `presentation-*` | 每屏鼠标光圈、点击和定位动画；与按键窗口共享输入服务，截图期间暂停。 |
| 截图 | `overlay-*` | 显示冻结画面，处理选区、标注、识别与输出。 |
| 贴图 | `pin_*` | 展示置顶截图，支持拖动、滚轮缩放和关闭。 |
| 管理员助手 | `--admin-helper` | 不初始化 Tauri/WebView；仅处理受控的 Scancode Map 映射请求与结果文件。 |

截图场景以不可变冻结画面为底图，预览与导出共用同一对象渲染器和历史记录。截图历史每条记录存储最终 PNG、manifest 与可重建缩略图；默认清理超过 30 天或 100 条的未收藏记录。

## 关键实现边界

- **任务栏挂件**：自动合并非虚拟网卡流量；旧的指定网卡配置读取后会迁移为空。数值采用固定槽位，`ResizeObserver` 仅在配置变更后同步宽度，避免因实时数值变化导致任务栏抖动。
- **仪表盘**：维护至多 5 分钟的内存环形采样，切换页面后保留、应用重启后清空；缺失数据以断点或空状态呈现，不伪造零值。
- **按键文本**：使用 Raw Input 的 `RIDEV_INPUTSINK` 接收后台键盘事件，不使用低级 Hook。只转换键帽名称，绝不拦截按键、不保存原始设备信息或扫描码；启用后固定于主显示器工作区左下角。
- **截图标注**：带文字箭头是单个场景对象，渲染、命中检测、缩放、导出与撤销/重做保持一致；不引入额外画布框架，避免双场景模型。
- **配置与 IPC**：设置使用原子 JSON 事务；普通 IPC 使用类型化绑定，图片等大二进制传输继续使用手写封装，不经 Base64 JSON。

演示模式的行为、持久化和人工验收路径见 [演示辅助](presentation-mode.md)。

## 开发与验证

安装依赖并进入开发模式：

```powershell
pnpm install
pnpm tauri dev
```

日常交付前只执行以下快速验证：

```powershell
pnpm typecheck
cd src-tauri
cargo test -- --skip model
```

OCR 模型初始化和性能测试默认忽略，避免日常验证加载模型资源。不要在常规修改后运行 `pnpm build`、模型初始化测试、`pnpm format:check` 或 `cargo fmt --check`。

## 发布

三处版本由统一命令同步：

```powershell
pnpm version:sync 1.1.0
```

GitHub Actions 负责校验、构建 Draft Release、验证签名、正式发布及 Winget 更新。完整步骤见 [发布与 Winget 指南](winget-publish-guide.md)，桌面人工验证见 [桌面冒烟测试清单](desktop-smoke-test.md)。
