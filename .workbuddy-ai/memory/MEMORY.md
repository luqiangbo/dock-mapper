# DockMapper 项目记忆

## 项目概况
- Windows 11 桌面效率工具：任务栏系统指标挂件 + 按键映射/按键文本 + 截图标注/OCR/贴图/历史
- 技术栈：Tauri 2 + Rust + React 19 + TypeScript + Ant Design + Rsbuild
- 包管理器：pnpm；目标平台：Windows 11 x64
- 本地优先：截图/OCR/配置均在本机处理，不引入云端依赖

## 关键架构
- 多窗口：main（主窗口）、taskbar_widget（任务栏挂件）、key_visualizer（按键文本）、overlay-*（截图）、pin_*（贴图）
- 单实例：重复启动只恢复已有窗口
- Rust 后端模块：config、screenshot/、history、key_mapping、key_visualizer、widget、ocr、translation/、sys_monitor、taskbar、tray
- 前端截图模块：src/screenshots/screenshot/ 下含 components（标注编辑器）、hooks（捕获/标注/OCR/贴图）、utils
- IPC：类型化绑定走 commands.ts/ipc.ts；图片二进制走手写封装 binaryPayload.ts
- 配置：原子 JSON 事务（config_transaction.rs）

## 开发约定（AGENTS.md）
- 通用 UI 优先复用 Ant Design，禁止重复造轮子
- 沿真实调用链定位问题：界面→前端状态→API→Tauri命令→Rust状态→持久化
- 不要扩大 ScreenshotOverlay.tsx 和 lib.rs，新交互放 hook/面板/领域模块
- 异步必须显式处理 loading/empty/success/failure
- 交付前只跑两项：`pnpm typecheck` 和 `cargo test -- --skip model`（src-tauri 目录）
- 不跑 pnpm build / format:check / cargo fmt --check / 模型测试

## OCR
- 使用 paddleocr_rs_onnx（PP-OCRv6 small），本地 vendor patch
- 模型测试标记 #[ignore]

## 按键映射
- 双层架构：运行时钩子（WH_KEYBOARD_LL，即时生效）+ 注册表 Scancode Map（持久，重启后生效）
- 运行时层：key_mapping_runtime/ 下 engine.rs + native.rs，进程内钩子+SendInput
- 注册表层：scancode_mapper.rs encode() 编码 KeyMapping 为 REG_BINARY，通过 admin helper UAC 写入
- admin.rs：ApplyScancodeMap 变体通过 JSON 文件 IPC + ShellExecuteExW("runas") 通信
- legacy_key_mapping.rs：apply() 原子写入注册表+配置（config_transaction），backup 到 keyboard-recovery/
- owns_scancode_map()：通过 applied_scancode_map 配置字段区分自身映射与外部映射
- effective()：waiting_restart 或外部映射时暂停运行时钩子；自身映射时允许运行
- 卸载不清理注册表，持久保留
- 禁用开关只暂停运行时钩子，不清注册表

## 截图标注
- 场景 reducer：多选、单层分组、图层、30步撤销
- RoughJS 渲染，元素有稳定 ID/seed/version
- 支持：矩形/椭圆/菱形/线/箭头/画笔/高亮/马赛克/文字/编号
- 箭头端点以目标局部归一化坐标绑定
