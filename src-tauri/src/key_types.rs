use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum KeyCode {
    Disabled,
    CapsLock,
    ShiftLeft,
    ShiftRight,
    ControlLeft,
    ControlRight,
    Alt,
    AltRight,
    AltGr,
    MetaLeft,
    MetaRight,
    Tab,
    Escape,
    Space,
    Return,
    Backspace,
    Delete,
    Insert,
    Home,
    End,
    PageUp,
    PageDown,
    F1,
    F2,
    F3,
    F4,
    F5,
    F6,
    F7,
    F8,
    F9,
    F10,
    F11,
    F12,
    KeyA,
    KeyB,
    KeyC,
    KeyD,
    KeyE,
    KeyF,
    KeyG,
    KeyH,
    KeyI,
    KeyJ,
    KeyK,
    KeyL,
    KeyM,
    KeyN,
    KeyO,
    KeyP,
    KeyQ,
    KeyR,
    KeyS,
    KeyT,
    KeyU,
    KeyV,
    KeyW,
    KeyX,
    KeyY,
    KeyZ,
    Num0,
    Num1,
    Num2,
    Num3,
    Num4,
    Num5,
    Num6,
    Num7,
    Num8,
    Num9,
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    Kp0,
    Kp1,
    Kp2,
    Kp3,
    Kp4,
    Kp5,
    Kp6,
    Kp7,
    Kp8,
    Kp9,
}

impl KeyCode {
    pub fn code(self) -> &'static str {
        match self {
            Self::Disabled => "Disabled",
            Self::CapsLock => "CapsLock",
            Self::ShiftLeft => "ShiftLeft",
            Self::ShiftRight => "ShiftRight",
            Self::ControlLeft => "ControlLeft",
            Self::ControlRight => "ControlRight",
            Self::Alt => "Alt",
            Self::AltRight => "AltRight",
            Self::AltGr => "AltGr",
            Self::MetaLeft => "MetaLeft",
            Self::MetaRight => "MetaRight",
            Self::Tab => "Tab",
            Self::Escape => "Escape",
            Self::Space => "Space",
            Self::Return => "Return",
            Self::Backspace => "Backspace",
            Self::Delete => "Delete",
            Self::Insert => "Insert",
            Self::Home => "Home",
            Self::End => "End",
            Self::PageUp => "PageUp",
            Self::PageDown => "PageDown",
            Self::F1 => "F1",
            Self::F2 => "F2",
            Self::F3 => "F3",
            Self::F4 => "F4",
            Self::F5 => "F5",
            Self::F6 => "F6",
            Self::F7 => "F7",
            Self::F8 => "F8",
            Self::F9 => "F9",
            Self::F10 => "F10",
            Self::F11 => "F11",
            Self::F12 => "F12",
            Self::KeyA => "KeyA",
            Self::KeyB => "KeyB",
            Self::KeyC => "KeyC",
            Self::KeyD => "KeyD",
            Self::KeyE => "KeyE",
            Self::KeyF => "KeyF",
            Self::KeyG => "KeyG",
            Self::KeyH => "KeyH",
            Self::KeyI => "KeyI",
            Self::KeyJ => "KeyJ",
            Self::KeyK => "KeyK",
            Self::KeyL => "KeyL",
            Self::KeyM => "KeyM",
            Self::KeyN => "KeyN",
            Self::KeyO => "KeyO",
            Self::KeyP => "KeyP",
            Self::KeyQ => "KeyQ",
            Self::KeyR => "KeyR",
            Self::KeyS => "KeyS",
            Self::KeyT => "KeyT",
            Self::KeyU => "KeyU",
            Self::KeyV => "KeyV",
            Self::KeyW => "KeyW",
            Self::KeyX => "KeyX",
            Self::KeyY => "KeyY",
            Self::KeyZ => "KeyZ",
            Self::Num0 => "Num0",
            Self::Num1 => "Num1",
            Self::Num2 => "Num2",
            Self::Num3 => "Num3",
            Self::Num4 => "Num4",
            Self::Num5 => "Num5",
            Self::Num6 => "Num6",
            Self::Num7 => "Num7",
            Self::Num8 => "Num8",
            Self::Num9 => "Num9",
            Self::ArrowUp => "ArrowUp",
            Self::ArrowDown => "ArrowDown",
            Self::ArrowLeft => "ArrowLeft",
            Self::ArrowRight => "ArrowRight",
            Self::Kp0 => "Kp0",
            Self::Kp1 => "Kp1",
            Self::Kp2 => "Kp2",
            Self::Kp3 => "Kp3",
            Self::Kp4 => "Kp4",
            Self::Kp5 => "Kp5",
            Self::Kp6 => "Kp6",
            Self::Kp7 => "Kp7",
            Self::Kp8 => "Kp8",
            Self::Kp9 => "Kp9",
        }
    }

    pub fn vk(self) -> u16 {
        match self {
            Self::Disabled => 0,
            Self::Backspace => 0x08,
            Self::Tab => 0x09,
            Self::Return => 0x0D,
            Self::ShiftLeft => 0xA0,
            Self::ShiftRight => 0xA1,
            Self::ControlLeft => 0xA2,
            Self::ControlRight => 0xA3,
            Self::Alt => 0xA4,
            Self::AltRight => 0xA5,
            Self::AltGr => 0xA5,
            Self::CapsLock => 0x14,
            Self::Escape => 0x1B,
            Self::Space => 0x20,
            Self::PageUp => 0x21,
            Self::PageDown => 0x22,
            Self::End => 0x23,
            Self::Home => 0x24,
            Self::ArrowLeft => 0x25,
            Self::ArrowUp => 0x26,
            Self::ArrowRight => 0x27,
            Self::ArrowDown => 0x28,
            Self::Insert => 0x2D,
            Self::Delete => 0x2E,
            Self::Num0 => 0x30,
            Self::Num1 => 0x31,
            Self::Num2 => 0x32,
            Self::Num3 => 0x33,
            Self::Num4 => 0x34,
            Self::Num5 => 0x35,
            Self::Num6 => 0x36,
            Self::Num7 => 0x37,
            Self::Num8 => 0x38,
            Self::Num9 => 0x39,
            Self::KeyA => 0x41,
            Self::KeyB => 0x42,
            Self::KeyC => 0x43,
            Self::KeyD => 0x44,
            Self::KeyE => 0x45,
            Self::KeyF => 0x46,
            Self::KeyG => 0x47,
            Self::KeyH => 0x48,
            Self::KeyI => 0x49,
            Self::KeyJ => 0x4A,
            Self::KeyK => 0x4B,
            Self::KeyL => 0x4C,
            Self::KeyM => 0x4D,
            Self::KeyN => 0x4E,
            Self::KeyO => 0x4F,
            Self::KeyP => 0x50,
            Self::KeyQ => 0x51,
            Self::KeyR => 0x52,
            Self::KeyS => 0x53,
            Self::KeyT => 0x54,
            Self::KeyU => 0x55,
            Self::KeyV => 0x56,
            Self::KeyW => 0x57,
            Self::KeyX => 0x58,
            Self::KeyY => 0x59,
            Self::KeyZ => 0x5A,
            Self::MetaLeft => 0x5B,
            Self::MetaRight => 0x5C,
            Self::Kp0 => 0x60,
            Self::Kp1 => 0x61,
            Self::Kp2 => 0x62,
            Self::Kp3 => 0x63,
            Self::Kp4 => 0x64,
            Self::Kp5 => 0x65,
            Self::Kp6 => 0x66,
            Self::Kp7 => 0x67,
            Self::Kp8 => 0x68,
            Self::Kp9 => 0x69,
            Self::F1 => 0x70,
            Self::F2 => 0x71,
            Self::F3 => 0x72,
            Self::F4 => 0x73,
            Self::F5 => 0x74,
            Self::F6 => 0x75,
            Self::F7 => 0x76,
            Self::F8 => 0x77,
            Self::F9 => 0x78,
            Self::F10 => 0x79,
            Self::F11 => 0x7A,
            Self::F12 => 0x7B,
        }
    }

    pub fn is_extended(self) -> bool {
        matches!(
            self,
            Self::ControlRight
                | Self::AltRight
                | Self::AltGr
                | Self::MetaLeft
                | Self::MetaRight
                | Self::Insert
                | Self::Delete
                | Self::Home
                | Self::End
                | Self::PageUp
                | Self::PageDown
                | Self::ArrowUp
                | Self::ArrowDown
                | Self::ArrowLeft
                | Self::ArrowRight
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyMapping {
    pub id: String,
    pub source_key: KeyCode,
    pub target_key: KeyCode,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SupportedKey {
    pub code: KeyCode,
    pub label: &'static str,
    pub group: &'static str,
}

pub(crate) fn supported_keys() -> Vec<SupportedKey> {
    const KEYS: &[KeyCode] = &[
        KeyCode::Disabled,
        KeyCode::CapsLock,
        KeyCode::ShiftLeft,
        KeyCode::ShiftRight,
        KeyCode::ControlLeft,
        KeyCode::ControlRight,
        KeyCode::Alt,
        KeyCode::AltRight,
        KeyCode::AltGr,
        KeyCode::MetaLeft,
        KeyCode::MetaRight,
        KeyCode::Tab,
        KeyCode::Escape,
        KeyCode::Space,
        KeyCode::Return,
        KeyCode::Backspace,
        KeyCode::Delete,
        KeyCode::Insert,
        KeyCode::Home,
        KeyCode::End,
        KeyCode::PageUp,
        KeyCode::PageDown,
        KeyCode::F1,
        KeyCode::F2,
        KeyCode::F3,
        KeyCode::F4,
        KeyCode::F5,
        KeyCode::F6,
        KeyCode::F7,
        KeyCode::F8,
        KeyCode::F9,
        KeyCode::F10,
        KeyCode::F11,
        KeyCode::F12,
        KeyCode::KeyA,
        KeyCode::KeyB,
        KeyCode::KeyC,
        KeyCode::KeyD,
        KeyCode::KeyE,
        KeyCode::KeyF,
        KeyCode::KeyG,
        KeyCode::KeyH,
        KeyCode::KeyI,
        KeyCode::KeyJ,
        KeyCode::KeyK,
        KeyCode::KeyL,
        KeyCode::KeyM,
        KeyCode::KeyN,
        KeyCode::KeyO,
        KeyCode::KeyP,
        KeyCode::KeyQ,
        KeyCode::KeyR,
        KeyCode::KeyS,
        KeyCode::KeyT,
        KeyCode::KeyU,
        KeyCode::KeyV,
        KeyCode::KeyW,
        KeyCode::KeyX,
        KeyCode::KeyY,
        KeyCode::KeyZ,
        KeyCode::Num0,
        KeyCode::Num1,
        KeyCode::Num2,
        KeyCode::Num3,
        KeyCode::Num4,
        KeyCode::Num5,
        KeyCode::Num6,
        KeyCode::Num7,
        KeyCode::Num8,
        KeyCode::Num9,
        KeyCode::ArrowUp,
        KeyCode::ArrowDown,
        KeyCode::ArrowLeft,
        KeyCode::ArrowRight,
        KeyCode::Kp0,
        KeyCode::Kp1,
        KeyCode::Kp2,
        KeyCode::Kp3,
        KeyCode::Kp4,
        KeyCode::Kp5,
        KeyCode::Kp6,
        KeyCode::Kp7,
        KeyCode::Kp8,
        KeyCode::Kp9,
    ];

    KEYS.iter()
        .copied()
        .map(|code| {
            let raw = code.code();
            let (label, group) = if let Some(label) = raw.strip_prefix("Key") {
                (label, "字母")
            } else if let Some(label) = raw.strip_prefix("Num") {
                (label, "数字")
            } else if raw.starts_with("Kp") {
                (raw, "数字键盘")
            } else if raw.starts_with('F') && raw[1..].chars().all(|char| char.is_ascii_digit()) {
                (raw, "功能键")
            } else {
                match code {
                    KeyCode::Disabled => ("禁用按键", "特殊操作"),
                    KeyCode::ControlLeft => ("左 Ctrl", "修饰键"),
                    KeyCode::ControlRight => ("右 Ctrl", "修饰键"),
                    KeyCode::ShiftLeft => ("左 Shift", "修饰键"),
                    KeyCode::ShiftRight => ("右 Shift", "修饰键"),
                    KeyCode::Alt => ("左 Alt", "修饰键"),
                    KeyCode::AltRight => ("右 Alt", "修饰键"),
                    KeyCode::AltGr => ("AltGr", "修饰键"),
                    KeyCode::MetaLeft => ("左 Win", "修饰键"),
                    KeyCode::MetaRight => ("右 Win", "修饰键"),
                    KeyCode::CapsLock => ("大写锁定 Caps Lock", "常用编辑键"),
                    KeyCode::Tab => ("制表 Tab", "常用编辑键"),
                    KeyCode::Escape => ("退出 Esc", "常用编辑键"),
                    KeyCode::Space => ("空格 Space", "常用编辑键"),
                    KeyCode::Return => ("回车 Enter", "常用编辑键"),
                    KeyCode::Backspace => ("退格 Backspace", "常用编辑键"),
                    KeyCode::Delete => ("删除 Delete", "常用编辑键"),
                    KeyCode::Insert => ("插入 Insert", "常用编辑键"),
                    KeyCode::Home => ("行首 Home", "方向与导航"),
                    KeyCode::End => ("行末 End", "方向与导航"),
                    KeyCode::PageUp => ("上翻页 Page Up", "方向与导航"),
                    KeyCode::PageDown => ("下翻页 Page Down", "方向与导航"),
                    KeyCode::ArrowUp => ("↑ 上", "方向与导航"),
                    KeyCode::ArrowDown => ("↓ 下", "方向与导航"),
                    KeyCode::ArrowLeft => ("← 左", "方向与导航"),
                    KeyCode::ArrowRight => ("→ 右", "方向与导航"),
                    _ => (raw, "控制与导航"),
                }
            };
            SupportedKey { code, label, group }
        })
        .collect()
}

#[cfg(test)]
mod display_tests {
    use super::*;
    #[test]
    fn mapping_names_distinguish_sides_and_use_familiar_names_without_changing_codes() {
        let keys = supported_keys();
        for (code, expected, group) in [
            (KeyCode::ControlLeft, "左 Ctrl", "修饰键"),
            (KeyCode::Alt, "左 Alt", "修饰键"),
            (KeyCode::AltRight, "右 Alt", "修饰键"),
            (KeyCode::ControlRight, "右 Ctrl", "修饰键"),
            (KeyCode::ShiftLeft, "左 Shift", "修饰键"),
            (KeyCode::ShiftRight, "右 Shift", "修饰键"),
            (KeyCode::MetaLeft, "左 Win", "修饰键"),
            (KeyCode::MetaRight, "右 Win", "修饰键"),
            (KeyCode::Return, "回车 Enter", "常用编辑键"),
            (KeyCode::PageUp, "上翻页 Page Up", "方向与导航"),
            (KeyCode::ArrowUp, "↑ 上", "方向与导航"),
            (KeyCode::Disabled, "禁用按键", "特殊操作"),
        ] {
            let key = keys.iter().find(|key| key.code == code).unwrap();
            assert_eq!(key.label, expected);
            assert_eq!(key.group, group);
        }
        assert!(keys
            .iter()
            .any(|key| key.code == KeyCode::KeyA && key.label == "A"));
        assert!(keys.iter().any(|key| key.code == KeyCode::Num0));
        assert!(keys.iter().any(|key| key.code == KeyCode::Kp0));
        assert_eq!(KeyCode::ControlLeft.code(), "ControlLeft");
    }
    #[test]
    fn right_alt_round_trips_separately_from_left_alt_and_legacy_altgr() {
        let mut config = crate::config::AppConfig::default();
        config.key_mappings.push(KeyMapping {
            id: "right-alt".into(),
            source_key: KeyCode::AltRight,
            target_key: KeyCode::Alt,
            enabled: true,
        });
        let json = serde_json::to_string(&config).unwrap();
        let restored: crate::config::AppConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.key_mappings[0].source_key, KeyCode::AltRight);
        assert_eq!(restored.key_mappings[0].target_key, KeyCode::Alt);
        assert_eq!(
            serde_json::from_str::<KeyCode>("\"AltGr\"").unwrap(),
            KeyCode::AltGr
        );
        assert_eq!(KeyCode::AltRight.vk(), 0xa5);
        assert!(KeyCode::AltRight.is_extended());
        assert!(!KeyCode::Alt.is_extended());
    }
}
