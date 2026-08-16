//! Windows Keyboard Layout\Scancode Map support.  Unlike a low-level hook this
//! is consumed by the keyboard driver after the next sign-in and remains active
//! when DockMapper is not running.
use crate::KeyMapping;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use windows::{
    core::w,
    Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW,
        RegSetValueExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE, REG_BINARY,
        REG_OPTION_NON_VOLATILE,
    },
};

const KEYBOARD_LAYOUT: windows::core::PCWSTR =
    w!("SYSTEM\\CurrentControlSet\\Control\\Keyboard Layout");
const VALUE_NAME: windows::core::PCWSTR = w!("Scancode Map");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScanCode(pub u16);

impl ScanCode {
    pub fn bytes(self) -> [u8; 2] {
        self.0.to_le_bytes()
    }
}

pub fn scan_code(code: crate::KeyCode) -> Option<ScanCode> {
    use crate::KeyCode::*;
    Some(ScanCode(match code {
        Disabled => 0,
        Backspace => 0x0e,
        Tab => 0x0f,
        Return => 0x1c,
        Escape => 0x01,
        Space => 0x39,
        CapsLock => 0x3a,
        ShiftLeft => 0x2a,
        ShiftRight => 0x36,
        ControlLeft => 0x1d,
        ControlRight => 0xe01d,
        Alt => 0x38,
        MetaLeft => 0xe05b,
        MetaRight => 0xe05c,
        Insert => 0xe052,
        Delete => 0xe053,
        Home => 0xe047,
        End => 0xe04f,
        PageUp => 0xe049,
        PageDown => 0xe051,
        ArrowUp => 0xe048,
        ArrowDown => 0xe050,
        ArrowLeft => 0xe04b,
        ArrowRight => 0xe04d,
        F1 => 0x3b,
        F2 => 0x3c,
        F3 => 0x3d,
        F4 => 0x3e,
        F5 => 0x3f,
        F6 => 0x40,
        F7 => 0x41,
        F8 => 0x42,
        F9 => 0x43,
        F10 => 0x44,
        F11 => 0x57,
        F12 => 0x58,
        KeyA => 0x1e,
        KeyB => 0x30,
        KeyC => 0x2e,
        KeyD => 0x20,
        KeyE => 0x12,
        KeyF => 0x21,
        KeyG => 0x22,
        KeyH => 0x23,
        KeyI => 0x17,
        KeyJ => 0x24,
        KeyK => 0x25,
        KeyL => 0x26,
        KeyM => 0x32,
        KeyN => 0x31,
        KeyO => 0x18,
        KeyP => 0x19,
        KeyQ => 0x10,
        KeyR => 0x13,
        KeyS => 0x1f,
        KeyT => 0x14,
        KeyU => 0x16,
        KeyV => 0x2f,
        KeyW => 0x11,
        KeyX => 0x2d,
        KeyY => 0x15,
        KeyZ => 0x2c,
        Num1 => 0x02,
        Num2 => 0x03,
        Num3 => 0x04,
        Num4 => 0x05,
        Num5 => 0x06,
        Num6 => 0x07,
        Num7 => 0x08,
        Num8 => 0x09,
        Num9 => 0x0a,
        Num0 => 0x0b,
        Kp0 => 0x52,
        Kp1 => 0x4f,
        Kp2 => 0x50,
        Kp3 => 0x51,
        Kp4 => 0x4b,
        Kp5 => 0x4c,
        Kp6 => 0x4d,
        Kp7 => 0x47,
        Kp8 => 0x48,
        Kp9 => 0x49,
        // AltGr is emitted as a multi-byte sequence and cannot be represented by Scancode Map.
        AltGr => return None,
    }))
}

pub fn encode(mappings: &[KeyMapping]) -> Result<Vec<u8>, String> {
    let enabled: Vec<_> = mappings.iter().filter(|item| item.enabled).collect();
    let mut seen = std::collections::HashSet::new();
    let mut value = vec![0; 8];
    value.extend_from_slice(&((enabled.len() as u32) + 1).to_le_bytes());
    for item in enabled {
        let source = scan_code(item.source_key)
            .ok_or_else(|| format!("{} 不支持系统扫描码映射", item.source_key.code()))?;
        if source.0 == 0 {
            return Err("源按键不能设为禁用".into());
        }
        let target = scan_code(item.target_key)
            .ok_or_else(|| format!("{} 不支持系统扫描码映射", item.target_key.code()))?;
        if source == target {
            return Err(format!("规则 {} 的源按键和目标按键相同", item.id));
        }
        if !seen.insert(source.0) {
            return Err(format!("存在重复源按键：{}", item.source_key.code()));
        }
        value.extend_from_slice(&target.bytes());
        value.extend_from_slice(&source.bytes());
    }
    value.extend_from_slice(&[0, 0, 0, 0]);
    Ok(value)
}

fn open(access: windows::Win32::System::Registry::REG_SAM_FLAGS) -> Result<HKEY, String> {
    let mut key = HKEY::default();
    unsafe { RegOpenKeyExW(HKEY_LOCAL_MACHINE, KEYBOARD_LAYOUT, None, access, &mut key) }
        .ok()
        .map_err(|error| error.to_string())?;
    Ok(key)
}

pub fn read() -> Result<Option<Vec<u8>>, String> {
    let key = open(KEY_READ)?;
    let mut size = 0;
    let result = unsafe { RegQueryValueExW(key, VALUE_NAME, None, None, None, Some(&mut size)) };
    if result.0 == 2 {
        unsafe {
            let _ = RegCloseKey(key);
        }
        return Ok(None);
    }
    result.ok().map_err(|error| error.to_string())?;
    let mut bytes = vec![0; size as usize];
    unsafe {
        RegQueryValueExW(
            key,
            VALUE_NAME,
            None,
            None,
            Some(bytes.as_mut_ptr()),
            Some(&mut size),
        )
    }
    .ok()
    .map_err(|error| error.to_string())?;
    unsafe {
        let _ = RegCloseKey(key);
    }
    bytes.truncate(size as usize);
    Ok(Some(bytes))
}

pub fn write(value: Option<&[u8]>) -> Result<(), String> {
    let mut key = HKEY::default();
    unsafe {
        RegCreateKeyExW(
            HKEY_LOCAL_MACHINE,
            KEYBOARD_LAYOUT,
            None,
            None,
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
    }
    .ok()
    .map_err(|error| error.to_string())?;
    let result = unsafe {
        match value {
            Some(bytes) => RegSetValueExW(key, VALUE_NAME, None, REG_BINARY, Some(bytes)),
            None => RegDeleteValueW(key, VALUE_NAME),
        }
    };
    unsafe {
        let _ = RegCloseKey(key);
    }
    if value.is_none() && result.0 == 2 {
        return Ok(());
    }
    result.ok().map_err(|error| error.to_string())
}

pub fn backup_encode(value: Option<&[u8]>) -> Option<String> {
    value.map(|bytes| BASE64.encode(bytes))
}
pub fn backup_decode(value: Option<&str>) -> Result<Option<Vec<u8>>, String> {
    match value {
        Some("") | None => Ok(None),
        Some(value) => BASE64
            .decode(value)
            .map(Some)
            .map_err(|error| error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::KeyCode;
    #[test]
    fn scancode_map_has_header_and_terminator() {
        let mapping = KeyMapping {
            id: "one".into(),
            source_key: KeyCode::CapsLock,
            target_key: KeyCode::Escape,
            enabled: true,
        };
        let bytes = encode(&[mapping]).unwrap();
        assert_eq!(&bytes[..8], &[0; 8]);
        assert_eq!(&bytes[8..12], &[2, 0, 0, 0]);
        assert_eq!(&bytes[12..16], &[1, 0, 0x3a, 0]);
        assert_eq!(&bytes[16..], &[0; 4]);
    }

    #[test]
    fn disabled_target_writes_zero_destination() {
        let mapping = KeyMapping {
            id: "disable-caps".into(),
            source_key: KeyCode::CapsLock,
            target_key: KeyCode::Disabled,
            enabled: true,
        };
        let bytes = encode(&[mapping]).unwrap();
        assert_eq!(&bytes[12..16], &[0, 0, 0x3a, 0]);
    }

    #[test]
    fn disabled_source_is_rejected() {
        let mapping = KeyMapping {
            id: "invalid".into(),
            source_key: KeyCode::Disabled,
            target_key: KeyCode::Escape,
            enabled: true,
        };
        assert!(encode(&[mapping]).is_err());
    }
}
