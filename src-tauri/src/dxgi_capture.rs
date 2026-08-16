//! Windows 11 desktop capture backed by DXGI Desktop Duplication.
//!
//! The WebView cannot consume a D3D texture directly, so the final readback is
//! intentionally one tightly-packed BGRA buffer. Keeping the device,
//! duplication object and staging texture alive avoids recreating those costly
//! COM objects for every global shortcut.

#![cfg(target_os = "windows")]

use std::{collections::HashMap, slice};

use windows::{
    core::Interface,
    Win32::{
        Foundation::{HMODULE, RECT},
        Graphics::{
            Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL},
            Direct3D11::{
                D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
                D3D11_CPU_ACCESS_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION,
                D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
            },
            Dxgi::{
                CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput1,
                IDXGIOutputDuplication,
            },
        },
    },
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug)]
pub struct BgraFrame {
    pub width: u32,
    pub height: u32,
    pub bytes: Vec<u8>,
}

struct OutputCapture {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    duplication: IDXGIOutputDuplication,
    staging: Option<ID3D11Texture2D>,
    width: u32,
    height: u32,
}

#[derive(Default)]
pub struct CaptureManager {
    outputs: HashMap<MonitorRect, OutputCapture>,
}

impl CaptureManager {
    pub fn prewarm(&mut self) {
        // Initialization is deliberately best-effort. A disconnected monitor,
        // RDP session or driver reset must never block application startup.
        for rect in enumerate_outputs() {
            let _ = self.ensure_output(rect);
        }
    }

    pub fn capture(&mut self, rect: MonitorRect, timeout_ms: u32) -> Result<BgraFrame, String> {
        if !self.outputs.contains_key(&rect) {
            self.ensure_output(rect)?;
        }
        let capture = self.outputs.get_mut(&rect).expect("DXGI output inserted");
        match capture.read_frame(timeout_ms) {
            Ok(frame) => Ok(frame),
            Err(error) => {
                // Access-lost is normal after display changes or driver resets.
                // Drop this entry so the next capture recreates it once.
                self.outputs.remove(&rect);
                Err(error)
            }
        }
    }

    fn ensure_output(&mut self, wanted: MonitorRect) -> Result<(), String> {
        let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1() }.map_err(display_error)?;
        let mut adapter_index = 0;
        loop {
            let adapter: IDXGIAdapter1 = match unsafe { factory.EnumAdapters1(adapter_index) } {
                Ok(adapter) => adapter,
                Err(_) => break,
            };
            let mut output_index = 0;
            loop {
                let output = match unsafe { adapter.EnumOutputs(output_index) } {
                    Ok(output) => output,
                    Err(_) => break,
                };
                let desc = unsafe { output.GetDesc() }.map_err(display_error)?;
                if rect_from_dxgi(desc.DesktopCoordinates) == wanted {
                    let output: IDXGIOutput1 = output.cast().map_err(display_error)?;
                    let mut device = None;
                    let mut context = None;
                    unsafe {
                        D3D11CreateDevice(
                            &adapter,
                            D3D_DRIVER_TYPE_UNKNOWN,
                            HMODULE::default(),
                            Default::default(),
                            None::<&[D3D_FEATURE_LEVEL]>,
                            D3D11_SDK_VERSION,
                            Some(&mut device),
                            None,
                            Some(&mut context),
                        )
                    }
                    .map_err(display_error)?;
                    let device =
                        device.ok_or_else(|| "DXGI did not create a D3D11 device".to_string())?;
                    let context =
                        context.ok_or_else(|| "DXGI did not create a D3D11 context".to_string())?;
                    let duplication =
                        unsafe { output.DuplicateOutput(&device) }.map_err(display_error)?;
                    self.outputs.insert(
                        wanted,
                        OutputCapture {
                            device,
                            context,
                            duplication,
                            staging: None,
                            width: wanted.width,
                            height: wanted.height,
                        },
                    );
                    return Ok(());
                }
                output_index += 1;
            }
            adapter_index += 1;
        }
        Err("No DXGI output matches the active monitor".into())
    }
}

impl OutputCapture {
    fn read_frame(&mut self, timeout_ms: u32) -> Result<BgraFrame, String> {
        let mut info = Default::default();
        let mut resource = None;
        unsafe {
            self.duplication
                .AcquireNextFrame(timeout_ms, &mut info, &mut resource)
        }
        .map_err(display_error)?;
        let result = (|| {
            let texture: ID3D11Texture2D = resource
                .as_ref()
                .ok_or_else(|| "DXGI returned an empty desktop frame".to_string())?
                .cast()
                .map_err(display_error)?;
            let mut desc = Default::default();
            unsafe { texture.GetDesc(&mut desc) };
            if desc.Width != self.width || desc.Height != self.height {
                return Err("DXGI output size changed".into());
            }
            if self.staging.is_none() {
                let staging_desc = D3D11_TEXTURE2D_DESC {
                    Width: desc.Width,
                    Height: desc.Height,
                    MipLevels: 1,
                    ArraySize: 1,
                    Format: desc.Format,
                    SampleDesc: desc.SampleDesc,
                    Usage: D3D11_USAGE_STAGING,
                    BindFlags: 0,
                    CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                    MiscFlags: 0,
                };
                let mut staging = None;
                unsafe {
                    self.device
                        .CreateTexture2D(&staging_desc, None, Some(&mut staging))
                }
                .map_err(display_error)?;
                self.staging = staging;
            }
            let staging = self
                .staging
                .as_ref()
                .ok_or_else(|| "DXGI staging texture is unavailable".to_string())?;
            unsafe { self.context.CopyResource(staging, &texture) };
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            unsafe {
                self.context
                    .Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
            }
            .map_err(display_error)?;
            let row_bytes = self.width as usize * 4;
            let mut bytes = vec![0_u8; row_bytes * self.height as usize];
            for row in 0..self.height as usize {
                let source = unsafe {
                    slice::from_raw_parts(
                        (mapped.pData as *const u8).add(row * mapped.RowPitch as usize),
                        row_bytes,
                    )
                };
                bytes[row * row_bytes..(row + 1) * row_bytes].copy_from_slice(source);
            }
            unsafe { self.context.Unmap(staging, 0) };
            Ok(BgraFrame {
                width: self.width,
                height: self.height,
                bytes,
            })
        })();
        let _ = unsafe { self.duplication.ReleaseFrame() };
        result
    }
}

fn enumerate_outputs() -> Vec<MonitorRect> {
    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    let mut adapter_index = 0;
    while let Ok(adapter) = unsafe { factory.EnumAdapters1(adapter_index) } {
        let mut output_index = 0;
        while let Ok(output) = unsafe { adapter.EnumOutputs(output_index) } {
            if let Ok(desc) = unsafe { output.GetDesc() } {
                result.push(rect_from_dxgi(desc.DesktopCoordinates));
            }
            output_index += 1;
        }
        adapter_index += 1;
    }
    result
}

fn rect_from_dxgi(rect: RECT) -> MonitorRect {
    MonitorRect {
        x: rect.left,
        y: rect.top,
        width: (rect.right - rect.left).max(0) as u32,
        height: (rect.bottom - rect.top).max(0) as u32,
    }
}

fn display_error(error: windows::core::Error) -> String {
    format!("DXGI capture failed: {error}")
}

#[cfg(test)]
mod tests {
    use super::MonitorRect;

    #[test]
    fn monitor_rect_is_hashable_for_per_output_cache() {
        let rect = MonitorRect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        assert_eq!(rect.width * rect.height, 2_073_600);
    }
}
