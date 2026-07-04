这里为你整理了一份可以直接复制的 **《Tauri 2.0 任务栏信息栏与按键映射工具——开发工程设计文档》**。这份文档完全基于你的现代技术栈（Tauri 2.0 + pnpm + Rsbuild + React + Semi Design）编写，梳理了系统架构、多窗口配置、Rust 底层 Win32 注入以及核心业务逻辑。

你可以直接将这篇文档整体复制并投喂给 DeepSeek，让它作为全局上下文，或者分模块让它生成代码。

---

# 开发工程设计文档：基于 Tauri 2.0 的 Windows 效率工具

## 1. 项目技术栈

* **容器框架：** Tauri 2.0 (Rust)
* **包管理工具：** pnpm
* **前端构建工具：** Rsbuild
* **前端视图框架：** React
* **UI 组件库：** Semi Design (@douyinfe/semi-ui)
* **Rust 核心依赖：** `windows` (Win32 API 绑定), `sysinfo` (系统硬件监控), `rdev` 或 `inputbot` (全局键盘钩子)

---

## 2. 系统架构与窗口设计

本项目采用**双窗口架构**，由一个 Rust 后端主进程管理：

1. **主配置窗口 (`main`)**
* **职责：** 提供高颜值的图形化界面，用于管理按键映射规则、设置天气城市、查看软件状态。
* **形态：** 常规 Windows 窗口（有边框、可拖拽、居中显示）。


2. **任务栏信息条窗口 (`taskbar_widget`)**
* **职责：** 常驻系统任务栏，高频（1s）渲染网速、内存使用率，低频（30min）渲染天气信息。
* **形态：** **强行嵌入任务栏、完全透明、无边框、无独立任务栏图标、支持鼠标穿透。**



---

## 3. 前端多页面与 `tauri.conf.json` 配置

### 3.1 `tauri.conf.json` 核心窗口配置

请严格按照以下配置初始化 Tauri 窗口，特别是 `taskbar_widget` 的特殊属性：

```json
{
  "productName": "DevTaskbarTools",
  "version": "1.0.0",
  "identifier": "com.dev.taskbar.tools",
  "bundle": {
    "targets": ["msi", "nsis"]
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "极客效率工具箱 - 配置中心",
        "width": 800,
        "height": 600,
        "resizable": true,
        "fullscreen": false,
        "decorations": true,
        "transparent": false
      },
      {
        "label": "taskbar_widget",
        "url": "/widget.html",
        "width": 320,
        "height": 40,
        "resizable": false,
        "decorations": false,
        "transparent": true,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "visible": true
      }
    ],
    "security": {
      "csp": null
    }
  }
}

```

### 3.2 Rsbuild 多页面配置 (`rsbuild.config.ts`)

为了同时打包主界面和任务栏小部件，需在 Rsbuild 中配置 MPA（多页面应用）：

```typescript
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    // 定义两个入口：主配置页面和任务栏挂件页面
    entry: {
      index: './src/main-entry.tsx',
      widget: './src/widget-entry.tsx',
    },
  },
  html: {
    // 自动生成对应的 html 文件
    template({ entryName }) {
      return entryName === 'widget' ? './widget.html' : './index.html';
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});

```

---

## 4. 后端核心：Win32 任务栏强嵌入实现 (Rust)

### 4.1 `Cargo.toml` 依赖引入

```toml
[dependencies]
tauri = { version = "2.0", features = [] }
serde = { version = "1.0", features = ["derive"] }
# Win32 API 绑定，必须开启以下 features
windows = { version = "0.52", features = [
    "Win32_Foundation",
    "Win32_UI_WindowsAndMessaging",
    "Win32_Graphics_Gdi"
] }
# 系统信息获取
sysinfo = "0.30"
# 全局按键捕获
rdev = "0.5"
tokio = { version = "1.0", features = ["full"] }

```

### 4.2 任务栏注入核心代码 (`src-tauri/src/taskbar.rs`)

利用 Windows 底层 API，将 Tauri 的 Webview 窗口句柄强制设置为 `Shell_TrayWnd`（任务栏）的子窗口，并修改其样式实现**无焦点、无独立任务栏图标、鼠标穿透**。

```rust
use tauri::WebviewWindow;
use std::ffi::CString;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowA, SetParent, GetWindowLongPtrW, SetWindowLongPtrW,
    GWL_EXSTYLE, GWL_STYLE, WS_CHILD, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN
};

pub fn embed_widget_to_taskbar(window: &WebviewWindow) {
    let window_hwnd = HWND(window.hwnd().unwrap().0 as _);

    unsafe {
        // 1. 寻找 Windows 主任务栏句柄
        let cls_name = CString::new("Shell_TrayWnd").unwrap();
        let taskbar_hwnd = FindWindowA(
            windows::core::PCSTR(cls_name.as_ptr() as *const u8),
            windows::core::PCSTR::null()
        );

        if taskbar_hwnd.0 != 0 {
            // 2. 剥离独立窗口属性，赋予子窗口属性 (WS_CHILD)
            let current_style = GetWindowLongPtrW(window_hwnd, GWL_STYLE);
            SetWindowLongPtrW(window_hwnd, GWL_STYLE, current_style | WS_CHILD.0 as isize);

            // 3. 赋予工具栏属性防止Alt+Tab可见 (WS_EX_TOOLWINDOW)，并开启鼠标穿透 (WS_EX_TRANSPARENT)
            let current_ex_style = GetWindowLongPtrW(window_hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(
                window_hwnd, 
                GWL_EXSTYLE, 
                current_ex_style | WS_EX_TOOLWINDOW.0 as isize | WS_EX_TRANSPARENT.0 as isize
            );

            // 4. 强行建立父子关系
            SetParent(window_hwnd, taskbar_hwnd);

            // 5. 初始化相对任务栏的精准坐标（对齐右侧系统托盘左边缘）
            // 提示：Win11 默认任务栏高度约 48px，X轴坐标通常需要根据屏幕宽度动态计算
            let screen_width = GetSystemMetrics(SM_CXSCREEN);
            let widget_width = 320; 
            let padding_right = 250; // 根据 Windows 系统托盘图标占用的宽度微调
            
            let relative_x = screen_width - widget_width - padding_right;
            let relative_y = 4; // 稍微居中微调

            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(relative_x, relative_y)));
        }
    }
}

```

---

## 5. 功能一：系统数据采集与事件推送

### 5.1 Rust 定时器与推模式数据流

不采用前端轮询，而是在 Rust 端维护一个单线程异步定时器，计算出差值网速后，主动 `emit` 给前端。

```rust
use sysinfo::{CpuExt, NetworkExt, System, SystemExt};
use std::time::Duration;
use tauri::Emitter;

#[derive(Clone, serde::Serialize)]
struct SysStatusPayload {
    upload_speed: f64,   // 字节/秒 (B/s)
    download_speed: f64, // 字节/秒 (B/s)
    memory_usage: f32,   // 百分比 (0.0 - 100.0)
}

pub fn start_sys_monitor(app_handle: tauri::AppHandle) {
    tokio::spawn(async move {
        let mut sys = System::new_all();
        loop {
            sys.refresh_networks();
            sys.refresh_memory();

            let mut total_rx = 0;
            let mut total_tx = 0;

            // 累加所有网卡的即时速度
            for (_, data) in sys.networks() {
                total_rx += data.received_bytes();
                total_tx += data.transmitted_bytes();
            }

            // sysinfo 默认返回的是近1秒的累计值
            let total_mem = sys.total_memory() as f32;
            let used_mem = sys.used_memory() as f32;
            let mem_percent = (used_mem / total_mem) * 100.0;

            let payload = SysStatusPayload {
                upload_speed: total_tx as f64,
                download_speed: total_rx as f64,
                memory_usage: mem_percent,
            };

            // 精准推送到任务栏部件窗口
            if let Some(widget_win) = app_handle.get_webview_window("taskbar_widget") {
                let _ = widget_win.emit("sys-status-update", payload);
            }

            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}

```

### 5.2 前端 Widget 渲染层 (`widget-entry.tsx`)

前端接收到网速字节流后，需要将其人性化转化为 `KB/s` 或 `MB/s`，并通过 Semi Design 进行极简排版。

```tsx
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { listen } from '@tauri-apps/api/event';
import { Progress, Typography } from '@douyinfe/semi-ui';
import './widget.css'; // 编写无背景、紧凑排版的样式

const { Text } = Typography;

interface SysStatus {
  upload_speed: number;
  download_speed: number;
  memory_usage: number;
}

function FormatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  const kb = bytesPerSec / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} K/s`;
  return `${(kb / 1024).toFixed(1)} M/s`;
}

export default function TaskbarWidget() {
  const [status, setStatus] = useState<SysStatus>({ upload_speed: 0, download_speed: 0, memory_usage: 0 });
  const [weather, setWeather] = useState<string>("晴 22℃");

  useEffect(() => {
    // 监听 Rust 后端高频推送
    const unlisten = listen<SysStatus>('sys-status-update', (event) => {
      setStatus(event.payload);
    });

    // 独立低频定时器获取天气信息 (避免占用网速定时器频率)
    const fetchWeather = async () => {
      // 填入你对接的天气 API 请求逻辑
      // setWeather("阴 18℃");
    };
    fetchWeather();
    const weatherInterval = setInterval(fetchWeather, 30 * 60 * 1000); // 30分钟更新一次

    return () => {
      unlisten.then(f => f());
      clearInterval(weatherInterval);
    };
  }, []);

  return (
    <div className="widget-container" style={{ display: 'flex', alignItems: 'center', gap: '12px', height: '100%', color: '#fff' }}>
      <div className="net-speed" style={{ display: 'flex', flexDirection: 'column', fontSize: '10px' }}>
        <Text size="small" type="success">↑ {FormatSpeed(status.upload_speed)}</Text>
        <Text size="small" type="warning">↓ {FormatSpeed(status.download_speed)}</Text>
      </div>
      <div className="mem-status" style={{ width: '60px' }}>
        <Progress percent={status.memory_usage} type="line" size="small" showInfo={false} stroke="var(--semi-color-info)" />
        <span style={{ fontSize: '10px' }}>RAM: {status.memory_usage.toFixed(0)}%</span>
      </div>
      <div className="weather-status">
        <Text size="small" style={{ color: '#aaa' }}>{weather}</Text>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<TaskbarWidget />);

```

---

## 6. 功能二：全局按键映射引擎 (Rust)

### 6.1 拦截与模拟分发设计

普通 `listen` 无法修改系统行为，必须使用 `rdev::grab`（事件捕获）。当下发的键触发映射规则时，返回 `None`（截断底层消息不上传给系统），然后通过系统级异步发送（`simulate`）重新合成新按键。

```rust
use rdev::{grab, Event, EventType, Key};
use std::sync::Mutex;
use std::collections::HashMap;

// 全局内存映射表：存储 源按键 -> 目标按键 的映射关系
lazy_static::lazy_static! {
    static ref KEY_MAP: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
}

pub fn start_key_mapper() {
    std::thread::spawn(|| {
        // grab 函数会阻塞当前线程
        grab(|event| {
            if let EventType::KeyPress(key) = event.event_type {
                // 判断当前按下的按键是否在用户的映射字典中
                if key == Key::CapsLock {
                    // 示例：拦截 CapsLock 并模拟发送 LeftCtrl
                    rdev::simulate(&EventType::KeyPress(Key::ControlLeft)).unwrap();
                    return None; // 返回 None，表示拦截当前物理按键，系统将感知不到用户按下了 CapsLock
                }
            }
            if let EventType::KeyRelease(key) = event.event_type {
                if key == Key::CapsLock {
                    rdev::simulate(&EventType::KeyRelease(Key::ControlLeft)).unwrap();
                    return None;
                }
            }
            Some(event) // 返回 Some(event) 则代表放行，不影响常规输入
        }).expect("Could not grab keyboard events");
    });
}

```

---

## 7. 给 DeepSeek 的具体开发指令 (提示词模版)

当你准备让 DeepSeek 开始写某个部分时，可以使用以下具体的 Prompts：

### Prompt 1：跑通多窗口骨架

> “请基于这份设计文档，使用 pnpm 初始化项目。首先请生成完整的 `tauri.conf.json`、`rsbuild.config.ts` 以及前端双页面入口 `src/main-entry.tsx` 和 `src/widget-entry.tsx` 的工程代码，确保运行 `pnpm tauri dev` 后能同时调起主配置页面窗口和一个独立的、无边框的 Widget 空白窗口。”

### Prompt 2：攻克任务栏强嵌入

> “现在我们需要攻克任务栏注入的核心。请参考文档中的 `src-tauri/src/taskbar.rs`，使用 Rust 的 `windows` 0.52 crate 写出完整的 Windows 句柄寻找与嵌入逻辑。请确保处理好异常，避免找不到任务栏时程序崩溃。并在 Tauri 的 `setup` 生命周期中正确绑定和执行。”

### Prompt 3：实现主配置页面与按键映射状态同步

> “请使用 React + Semi Design 组件库，在主配置页面（`main` 窗口）中设计一个现代化的管理表格。用户可以在表格中添加『物理按键 -> 映射按键』的规则（例如将 CapsLock 映射为 Windows 键）。表格修改后，通过 Tauri 的 `invoke` 命令把最新的映射规则同步给 Rust 后端，更新 Rust 的全局缓存字典，以便让 `rdev` 实时应用新的映射效果。”
