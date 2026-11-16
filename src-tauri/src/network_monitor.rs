//! Windows interface counters: physical links once, one default route as fallback.
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use windows::Win32::{NetworkManagement::IpHelper::*, Networking::WinSock::AF_UNSPEC};

#[derive(Clone, Copy)]
struct Interface {
    id: u64,
    index: u32,
    hardware: bool,
    up: bool,
    kind: u32,
}

fn select(interfaces: &[Interface], fallback: Option<u32>) -> Vec<Interface> {
    let physical: Vec<_> = interfaces
        .iter()
        .copied()
        .filter(|i| i.up && i.hardware && i.kind != 24 && i.kind != 131)
        .collect();
    if !physical.is_empty() {
        return physical;
    }
    interfaces
        .iter()
        .copied()
        .filter(|i| i.up && i.kind != 24 && Some(i.index) == fallback)
        .take(1)
        .collect()
}

#[derive(Default)]
struct Baselines(HashMap<u64, (u64, u64, Instant)>);
impl Baselines {
    fn sample(&mut self, id: u64, received: u64, sent: u64, now: Instant) -> (f64, f64) {
        let previous = self.0.insert(id, (received, sent, now));
        let Some((rx, tx, at)) = previous else {
            return (0.0, 0.0);
        };
        if received < rx || sent < tx {
            return (0.0, 0.0);
        }
        let elapsed = now.duration_since(at).as_secs_f64().max(0.001);
        (
            (sent - tx) as f64 / elapsed,
            (received - rx) as f64 / elapsed,
        )
    }
}

#[derive(Default)]
pub struct NetworkMonitor {
    interfaces: Vec<Interface>,
    refreshed: Option<Instant>,
    baseline: Baselines,
}
impl NetworkMonitor {
    pub fn reset(&mut self) {
        self.baseline.0.clear();
        self.refreshed = None;
    }

    fn refresh(&mut self, now: Instant) -> Result<(), String> {
        unsafe {
            let mut table = std::ptr::null_mut();
            GetIfTable2(&mut table).ok().map_err(|e| e.to_string())?;
            if table.is_null() {
                return Err("Windows 未返回网卡列表".into());
            }
            let rows =
                std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize);
            let interfaces: Vec<_> = rows
                .iter()
                .map(|r| Interface {
                    id: r.InterfaceLuid.Value,
                    index: r.InterfaceIndex,
                    hardware: r.InterfaceAndOperStatusFlags._bitfield & 1 != 0,
                    up: r.OperStatus.0 == 1,
                    kind: r.Type,
                })
                .collect();
            FreeMibTable(table.cast());
            let fallback = if interfaces
                .iter()
                .any(|i| i.up && i.hardware && i.kind != 24 && i.kind != 131)
            {
                None
            } else {
                let mut routes = std::ptr::null_mut();
                GetIpForwardTable2(AF_UNSPEC, &mut routes)
                    .ok()
                    .map_err(|e| e.to_string())?;
                if routes.is_null() {
                    return Err("Windows 未返回路由列表".into());
                }
                let rows = std::slice::from_raw_parts(
                    (*routes).Table.as_ptr(),
                    (*routes).NumEntries as usize,
                );
                let best = rows
                    .iter()
                    .filter(|r| {
                        !r.Loopback
                            && r.DestinationPrefix.PrefixLength == 0
                            && interfaces
                                .iter()
                                .any(|i| i.up && i.index == r.InterfaceIndex)
                    })
                    .min_by_key(|r| (r.Metric, r.InterfaceIndex))
                    .map(|r| r.InterfaceIndex);
                FreeMibTable(routes.cast());
                best
            };
            self.interfaces = select(&interfaces, fallback);
            self.baseline
                .0
                .retain(|id, _| self.interfaces.iter().any(|i| i.id == *id));
            self.refreshed = Some(now);
            Ok(())
        }
    }

    pub fn sample(&mut self, now: Instant) -> Result<(f64, f64, bool), String> {
        if self
            .refreshed
            .is_none_or(|at| now.duration_since(at) >= Duration::from_secs(5))
        {
            if let Err(error) = self.refresh(now) {
                self.reset();
                return Err(error);
            }
        }
        let (mut upload, mut download, mut available) = (0.0, 0.0, false);
        let mut failed = None;
        for interface in &self.interfaces {
            let mut row = MIB_IF_ROW2::default();
            row.InterfaceLuid.Value = interface.id;
            let result = unsafe { GetIfEntry2(&mut row) };
            if result.is_err() || row.OperStatus.0 != 1 {
                if let Err(error) = result.ok() {
                    failed = Some(format!("读取网卡计数失败：{error}"));
                }
                self.refreshed = None;
                self.baseline.0.remove(&interface.id);
                continue;
            }
            let (up, down) = self
                .baseline
                .sample(interface.id, row.InOctets, row.OutOctets, now);
            upload += up;
            download += down;
            available = true;
        }
        if let Some(error) = failed {
            return Err(error);
        }
        Ok((upload, download, available))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn interface(id: u32, hardware: bool) -> Interface {
        Interface {
            id: id.into(),
            index: id,
            hardware,
            up: true,
            kind: 6,
        }
    }
    #[test]
    fn physical_links_are_summed_once_without_adding_the_vpn_tunnel() {
        let interfaces = [interface(1, true), interface(2, true), interface(3, false)];
        let selected = select(&interfaces, Some(3));
        assert_eq!(
            selected.iter().map(|i| i.index).collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(
            select(&[interface(3, false), interface(4, false)], Some(3)).len(),
            1
        );
        assert!(select(
            &[Interface {
                up: false,
                ..interface(1, true)
            }],
            None
        )
        .is_empty());
    }
    #[test]
    fn counters_use_each_interfaces_elapsed_time_and_reconnect_without_spikes() {
        let now = Instant::now();
        let mut baseline = Baselines::default();
        assert_eq!(baseline.sample(1, 100, 200, now), (0.0, 0.0));
        assert_eq!(
            baseline.sample(1, 200, 250, now + Duration::from_millis(500)),
            (100.0, 200.0)
        );
        assert_eq!(baseline.sample(2, 90000, 80000, now), (0.0, 0.0));
        assert_eq!(
            baseline.sample(1, 0, 0, now + Duration::from_secs(1)),
            (0.0, 0.0)
        );
        baseline.0.clear();
        assert_eq!(
            baseline.sample(1, 100000, 200000, now + Duration::from_secs(10)),
            (0.0, 0.0)
        );
    }
}
