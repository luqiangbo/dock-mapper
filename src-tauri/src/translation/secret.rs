//! Read-only migration of previously encrypted DeepL keys. New writes are plaintext.
use base64::{engine::general_purpose::STANDARD, Engine};
use windows::Win32::{
    Foundation::{LocalFree, HLOCAL},
    Security::Cryptography::{CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
};

pub(super) fn decrypt(value: &str) -> Result<String, String> {
    let bytes = STANDARD
        .decode(value)
        .map_err(|_| "旧翻译密钥无法读取，请重新配置")?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len().try_into().map_err(|_| "旧翻译密钥过大")?,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|_| "旧翻译密钥无法读取，请重新配置")?;
        let result = if output.cbData == 0 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
        };
        if !output.pbData.is_null() {
            std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
            let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        }
        String::from_utf8(result).map_err(|_| "旧翻译密钥无法读取，请重新配置".into())
    }
}

#[cfg(test)]
pub(super) fn encrypt_fixture(value: &str) -> String {
    use windows::{core::PCWSTR, Win32::Security::Cryptography::CryptProtectData};
    let input = CRYPT_INTEGER_BLOB {
        cbData: value.len() as u32,
        pbData: value.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .unwrap();
        let encoded = STANDARD.encode(std::slice::from_raw_parts(
            output.pbData,
            output.cbData as usize,
        ));
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        encoded
    }
}
