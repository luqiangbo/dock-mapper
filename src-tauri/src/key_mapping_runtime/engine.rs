use crate::{scancode_mapper, KeyCode, KeyMapping};
use std::collections::{BTreeMap, BTreeSet};

pub type Rules = BTreeMap<u16, u16>;
pub fn rules(mappings: &[KeyMapping]) -> Result<Rules, String> {
    let mut result = Rules::new();
    let mut seen = BTreeSet::new();
    for mapping in mappings {
        if mapping.source_key == KeyCode::Disabled {
            return Err("源按键不能为禁用".into());
        }
        let source = scancode_mapper::scan_code(mapping.source_key)
            .ok_or("源按键不支持运行时映射")?
            .0;
        let target = scancode_mapper::scan_code(mapping.target_key)
            .ok_or("目标按键不支持运行时映射")?
            .0;
        if source == target {
            return Err("源按键和目标按键不能相同".into());
        }
        if !seen.insert(source) {
            return Err("存在重复源按键".into());
        }
        if mapping.enabled {
            result.insert(source, target);
        }
    }
    Ok(result)
}

#[derive(Default)]
pub struct Engine {
    pub rules: Rules,
    held: BTreeMap<u16, u16>,
    targets: BTreeMap<u16, usize>,
    physical: BTreeSet<u16>,
    suppressed: BTreeSet<u16>,
    releases: BTreeSet<u16>,
    pub faulted: bool,
}
impl Engine {
    pub fn observe_pressed(&mut self, scan: u16) {
        self.physical.insert(scan);
    }
    pub fn reset_unhooked(&mut self) {
        self.physical.clear();
        self.suppressed.clear();
    }
    pub fn bypass(&mut self, source: u16, down: bool, mut inject: impl FnMut(u16, bool) -> bool) {
        self.release_source(source, &mut inject);
        self.suppressed.remove(&source);
        if down {
            self.physical.insert(source);
        } else {
            self.physical.remove(&source);
        }
    }
    fn release_source(&mut self, source: u16, inject: &mut impl FnMut(u16, bool) -> bool) {
        if let Some(target) = self.held.remove(&source) {
            if target == 0 {
                return;
            }
            let owners = self.targets.get_mut(&target).expect("held target owner");
            *owners -= 1;
            if *owners == 0 {
                self.targets.remove(&target);
                if !self.physical.contains(&target) && !inject(target, false) {
                    self.releases.insert(target);
                    self.faulted = true;
                }
            }
        }
    }
    pub fn release_all(&mut self, mut inject: impl FnMut(u16, bool) -> bool) -> Result<(), String> {
        self.suppressed.extend(self.held.keys().copied());
        self.releases.extend(self.targets.keys().copied());
        self.held.clear();
        self.targets.clear();
        self.releases
            .retain(|target| !self.physical.contains(target) && !inject(*target, false));
        if self.releases.is_empty() {
            Ok(())
        } else {
            self.faulted = true;
            Err("无法释放合成按键，请切回普通权限窗口后重试映射".into())
        }
    }
    /// true suppresses the physical event. Only called for non-injected keyboard events.
    pub fn input(
        &mut self,
        source: u16,
        down: bool,
        mut inject: impl FnMut(u16, bool) -> bool,
    ) -> bool {
        self.releases
            .retain(|target| !self.physical.contains(target) && !inject(*target, false));
        if self.suppressed.contains(&source) {
            if !down {
                self.suppressed.remove(&source);
            }
            return true;
        }
        if let Some(&target) = self.held.get(&source) {
            if !down {
                self.release_source(source, &mut inject);
                return true;
            }
            if target == 0 || inject(target, true) {
                return true;
            }
            self.faulted = true;
            self.release_source(source, &mut inject);
            self.physical.insert(source);
            return false;
        }
        if down && !self.physical.contains(&source) && !self.faulted {
            if let Some(&target) = self.rules.get(&source) {
                if target == 0
                    || self.targets.contains_key(&target)
                    || self.physical.contains(&target)
                    || inject(target, true)
                {
                    self.held.insert(source, target);
                    if target != 0 {
                        *self.targets.entry(target).or_default() += 1;
                    }
                    return true;
                }
                self.faulted = true;
            }
        }
        if down {
            self.physical.insert(source);
            false
        } else {
            self.physical.remove(&source);
            self.targets.contains_key(&source)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn left_and_right_modifiers_keep_distinct_extended_scan_codes() {
        let pairs = [
            (KeyCode::Alt, KeyCode::AltRight, 0x38, 0xe038),
            (KeyCode::ControlLeft, KeyCode::ControlRight, 0x1d, 0xe01d),
            (KeyCode::ShiftLeft, KeyCode::ShiftRight, 0x2a, 0x36),
            (KeyCode::MetaLeft, KeyCode::MetaRight, 0xe05b, 0xe05c),
        ];
        for (left, right, left_scan, right_scan) in pairs {
            let mappings = [
                KeyMapping {
                    id: "left".into(),
                    source_key: left,
                    target_key: right,
                    enabled: true,
                },
                KeyMapping {
                    id: "right".into(),
                    source_key: right,
                    target_key: left,
                    enabled: true,
                },
            ];
            assert_eq!(
                rules(&mappings).unwrap(),
                Rules::from([(left_scan, right_scan), (right_scan, left_scan)])
            );
        }
    }
    #[test]
    fn right_alt_can_be_a_source_target_or_disabled_without_remapping_left_alt() {
        for (source, target) in [
            (KeyCode::AltRight, KeyCode::Escape),
            (KeyCode::CapsLock, KeyCode::AltRight),
            (KeyCode::AltRight, KeyCode::Disabled),
        ] {
            let mapping = KeyMapping {
                id: "alt".into(),
                source_key: source,
                target_key: target,
                enabled: true,
            };
            let mut engine = Engine {
                rules: rules(&[mapping]).unwrap(),
                ..Default::default()
            };
            assert!(!engine.input(0x38, true, |_, _| panic!("left Alt was remapped")));
            assert!(!engine.input(0x38, false, |_, _| panic!("left Alt was remapped")));
            let mut events = Vec::new();
            for down in [true, true, false] {
                assert!(engine.input(
                    scancode_mapper::scan_code(source).unwrap().0,
                    down,
                    |key, down| {
                        events.push((key, down));
                        true
                    }
                ));
            }
            let expected = if target == KeyCode::Disabled {
                vec![]
            } else {
                let scan = scancode_mapper::scan_code(target).unwrap().0;
                vec![(scan, true), (scan, true), (scan, false)]
            };
            assert_eq!(events, expected);
        }
    }
    #[test]
    fn multiple_sources_hold_one_target_until_the_last_release() {
        let mut engine = Engine {
            rules: [(1, 3), (2, 3)].into(),
            ..Default::default()
        };
        let mut events = Vec::new();
        for (source, down) in [(1, true), (2, true), (1, false)] {
            engine.input(source, down, |key, down| {
                events.push((key, down));
                true
            });
        }
        assert_eq!(events, [(3, true)]);
        engine.input(2, false, |key, down| {
            events.push((key, down));
            true
        });
        assert_eq!(events, [(3, true), (3, false)]);
    }
    #[test]
    fn unavailable_window_keeps_the_original_key_instead_of_a_disabled_target() {
        let mut engine = Engine {
            rules: [(1, 0)].into(),
            ..Default::default()
        };
        engine.bypass(1, true, |_, _| panic!("disabled target injected"));
        assert!(!engine.input(1, true, |_, _| panic!("held bypass key remapped")));
        assert!(!engine.input(1, false, |_, _| panic!("bypass up remapped")));
        assert!(engine.input(1, true, |_, _| panic!("disabled target injected")));
    }
    #[test]
    fn changing_a_held_rule_releases_old_target_and_waits_for_a_new_press() {
        let mut engine = Engine {
            rules: [(1, 0xe01d)].into(),
            ..Default::default()
        };
        let mut events = Vec::new();
        engine.input(1, true, |key, down| {
            events.push((key, down));
            true
        });
        engine
            .release_all(|key, down| {
                events.push((key, down));
                true
            })
            .unwrap();
        engine.rules = [(1, 3)].into();
        assert!(engine.input(1, true, |_, _| panic!("repeat used changed target")));
        assert!(engine.input(1, false, |_, _| panic!("old up used changed target")));
        engine.input(1, true, |key, down| {
            events.push((key, down));
            true
        });
        assert_eq!(events, [(0xe01d, true), (0xe01d, false), (3, true)]);
    }
    #[test]
    fn resume_after_unhook_does_not_keep_a_stale_suppressed_key() {
        let mut engine = Engine {
            rules: [(1, 2)].into(),
            ..Default::default()
        };
        engine.input(1, true, |_, _| true);
        engine.release_all(|_, _| true).unwrap();
        engine.reset_unhooked();
        let mut events = Vec::new();
        engine.input(1, true, |key, down| {
            events.push((key, down));
            true
        });
        assert_eq!(events, [(2, true)]);
    }
    #[test]
    fn unsupported_altgr_duplicate_sources_and_disabled_sources_are_rejected() {
        let mut mapping = KeyMapping {
            id: "a".into(),
            source_key: KeyCode::AltGr,
            target_key: KeyCode::KeyA,
            enabled: true,
        };
        assert!(rules(&[mapping.clone()]).is_err());
        mapping.source_key = KeyCode::Disabled;
        assert!(rules(&[mapping.clone()]).is_err());
        mapping.source_key = KeyCode::KeyB;
        assert!(rules(&[mapping.clone(), mapping]).is_err());
    }
    #[test]
    fn repeating_a_key_and_releasing_it_uses_one_target_until_key_up() {
        let mut engine = Engine {
            rules: [(1, 2)].into(),
            ..Default::default()
        };
        let mut events = Vec::new();
        for down in [true, true, false] {
            assert!(engine.input(1, down, |key, down| {
                events.push((key, down));
                true
            }));
        }
        assert_eq!(events, [(2, true), (2, true), (2, false)]);
    }
    #[test]
    fn two_sources_and_a_physical_target_do_not_release_each_other() {
        let mut engine = Engine {
            rules: [(1, 3), (2, 3)].into(),
            ..Default::default()
        };
        let mut events = Vec::new();
        for (source, down) in [
            (3, true),
            (1, true),
            (2, true),
            (3, false),
            (1, false),
            (2, false),
        ] {
            engine.input(source, down, |key, down| {
                events.push((key, down));
                true
            });
        }
        assert_eq!(events, [(3, false)]);
    }
    #[test]
    fn disabled_keys_emit_nothing_and_pause_releases_modifiers_before_ignoring_old_key_up() {
        let mut engine = Engine {
            rules: [(1, 0), (2, 0x1d)].into(),
            ..Default::default()
        };
        assert!(engine.input(1, true, |_, _| panic!("disabled key injected")));
        assert!(engine.input(1, false, |_, _| panic!("disabled key injected")));
        engine.input(2, true, |_, _| true);
        let mut released = Vec::new();
        engine
            .release_all(|key, down| {
                released.push((key, down));
                true
            })
            .unwrap();
        assert_eq!(released, [(0x1d, false)]);
        assert!(engine.input(2, false, |_, _| panic!("old release remapped")));
    }
    #[test]
    fn failed_injection_preserves_original_key_and_pauses_new_remaps() {
        let mut engine = Engine {
            rules: [(1, 2)].into(),
            ..Default::default()
        };
        assert!(!engine.input(1, true, |_, _| false));
        assert!(!engine.input(1, false, |_, _| false));
        assert!(engine.faulted);
        assert!(!engine.input(1, true, |_, _| panic!("faulted remapper injected")));
    }
    #[test]
    fn failed_modifier_release_is_retained_for_retry() {
        let mut engine = Engine {
            rules: [(1, 2)].into(),
            ..Default::default()
        };
        engine.input(1, true, |_, _| true);
        assert!(engine.release_all(|_, _| false).is_err());
        assert!(engine.release_all(|_, _| true).is_ok());
    }
}
