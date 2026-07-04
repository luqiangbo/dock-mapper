use lazy_static::lazy_static;
use rdev::{grab, simulate, EventType, Key};
use std::collections::HashMap;
use std::sync::Mutex;

use crate::KeyMapping;

lazy_static! {
    /// Global in-memory mapping table: source_key -> target_key
    static ref KEY_MAP: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
}

/// Returns the current key mappings as a Vec (for the Tauri command).
pub fn get_mappings() -> Vec<KeyMapping> {
    let map = KEY_MAP.lock().unwrap();
    map.iter()
        .enumerate()
        .map(|(i, (source, target))| KeyMapping {
            id: format!("rule_{i}"),
            source_key: source.clone(),
            target_key: target.clone(),
            enabled: true,
        })
        .collect()
}

/// Replaces the global mapping table with the user's latest rules.
/// Only enabled mappings are inserted.
pub fn update_mappings(mappings: Vec<KeyMapping>) {
    let mut map = KEY_MAP.lock().unwrap();
    map.clear();
    for m in mappings {
        if m.enabled {
            map.insert(m.source_key.clone(), m.target_key.clone());
        }
    }
    println!("[key_mapper] Updated {} mapping(s)", map.len());
}

/// Attempts to parse a string key name into an `rdev::Key`.
///
/// Uses the exact `Debug` representation of the `Key` variant as the key name
/// so the frontend can send `"CapsLock"`, `"ControlLeft"`, `"Num0"`, etc.
fn str_to_key(s: &str) -> Option<Key> {
    use Key::*;
    match s {
        "CapsLock" => Some(CapsLock),
        "ShiftLeft" => Some(ShiftLeft),
        "ShiftRight" => Some(ShiftRight),
        "ControlLeft" => Some(ControlLeft),
        "ControlRight" => Some(ControlRight),
        "Alt" => Some(Alt),
        "AltGr" => Some(AltGr),
        "MetaLeft" => Some(MetaLeft),
        "MetaRight" => Some(MetaRight),
        "Tab" => Some(Tab),
        "Escape" => Some(Escape),
        "Space" => Some(Space),
        "Return" => Some(Return),
        "Backspace" => Some(Backspace),
        "Delete" => Some(Delete),
        "Insert" => Some(Insert),
        "Home" => Some(Home),
        "End" => Some(End),
        "PageUp" => Some(PageUp),
        "PageDown" => Some(PageDown),
        "F1" => Some(F1),
        "F2" => Some(F2),
        "F3" => Some(F3),
        "F4" => Some(F4),
        "F5" => Some(F5),
        "F6" => Some(F6),
        "F7" => Some(F7),
        "F8" => Some(F8),
        "F9" => Some(F9),
        "F10" => Some(F10),
        "F11" => Some(F11),
        "F12" => Some(F12),
        "KeyA" => Some(KeyA),
        "KeyB" => Some(KeyB),
        "KeyC" => Some(KeyC),
        "KeyD" => Some(KeyD),
        "KeyE" => Some(KeyE),
        "KeyF" => Some(KeyF),
        "KeyG" => Some(KeyG),
        "KeyH" => Some(KeyH),
        "KeyI" => Some(KeyI),
        "KeyJ" => Some(KeyJ),
        "KeyK" => Some(KeyK),
        "KeyL" => Some(KeyL),
        "KeyM" => Some(KeyM),
        "KeyN" => Some(KeyN),
        "KeyO" => Some(KeyO),
        "KeyP" => Some(KeyP),
        "KeyQ" => Some(KeyQ),
        "KeyR" => Some(KeyR),
        "KeyS" => Some(KeyS),
        "KeyT" => Some(KeyT),
        "KeyU" => Some(KeyU),
        "KeyV" => Some(KeyV),
        "KeyW" => Some(KeyW),
        "KeyX" => Some(KeyX),
        "KeyY" => Some(KeyY),
        "KeyZ" => Some(KeyZ),
        "Num0" => Some(Num0),
        "Num1" => Some(Num1),
        "Num2" => Some(Num2),
        "Num3" => Some(Num3),
        "Num4" => Some(Num4),
        "Num5" => Some(Num5),
        "Num6" => Some(Num6),
        "Num7" => Some(Num7),
        "Num8" => Some(Num8),
        "Num9" => Some(Num9),
        "ArrowUp" => Some(UpArrow),
        "ArrowDown" => Some(DownArrow),
        "ArrowLeft" => Some(LeftArrow),
        "ArrowRight" => Some(RightArrow),
        "Kp0" => Some(Kp0),
        "Kp1" => Some(Kp1),
        "Kp2" => Some(Kp2),
        "Kp3" => Some(Kp3),
        "Kp4" => Some(Kp4),
        "Kp5" => Some(Kp5),
        "Kp6" => Some(Kp6),
        "Kp7" => Some(Kp7),
        "Kp8" => Some(Kp8),
        "Kp9" => Some(Kp9),
        _ => None,
    }
}

/// Starts the global keyboard hook that intercepts mapped keys and
/// simulates their target keys instead.
///
/// This runs on a blocking thread because `rdev::grab` blocks.
pub fn start_key_mapper() {
    std::thread::spawn(|| {
        println!("[key_mapper] Global keyboard hook started");

        if let Err(e) = grab(|event| {
            let key = match event.event_type {
                EventType::KeyPress(k) | EventType::KeyRelease(k) => k,
                _ => return Some(event),
            };

            // Look up whether this key is being remapped.
            // rdev's Debug representation of Key matches our frontend key names.
            let key_name = format!("{:?}", key);
            let target_name = KEY_MAP.lock().unwrap().get(&key_name).cloned();

            if let Some(target) = target_name {
                if let Some(target_key) = str_to_key(&target) {
                    // Simulate the target key event
                    let event_type = match event.event_type {
                        EventType::KeyPress(_) => EventType::KeyPress(target_key),
                        EventType::KeyRelease(_) => EventType::KeyRelease(target_key),
                        _ => unreachable!(),
                    };
                    let _ = simulate(&event_type);
                    // Block the original physical key from reaching the system
                    return None;
                }
            }

            // Not mapped – let the event pass through
            Some(event)
        }) {
            eprintln!("[key_mapper] grab error: {e:?}");
        }
    });
}
