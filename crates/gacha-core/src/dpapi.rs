//! Windows' data protection (DPAPI): bytes only this Windows user can read back, for secrets kept on disk like the
//! AI helper's Gemini key. Owner: SETTINGS/AI area.
use crate::error::{Error, Result};

#[cfg(windows)]
fn run(data: &[u8], seal: bool) -> Result<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN};
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    // SAFETY: the input blob points at `data`, which outlives the call; the output is allocated by the system and
    // freed below with LocalFree after copying it out
    let ok = unsafe {
        if seal {
            CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        } else {
            CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        }
    };
    if ok == 0 || out.pbData.is_null() {
        return Err(Error::Invalid("Windows couldn't protect the saved key".into()));
    }
    // SAFETY: on success the system set pbData to cbData readable bytes
    let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
    unsafe { LocalFree(out.pbData as _) };
    Ok(bytes)
}

#[cfg(not(windows))]
fn run(_: &[u8], _: bool) -> Result<Vec<u8>> {
    Err(Error::Invalid("Saving keys works on Windows only".into()))
}

pub fn protect(data: &[u8]) -> Result<Vec<u8>> {
    run(data, true)
}

pub fn unprotect(data: &[u8]) -> Result<Vec<u8>> {
    run(data, false)
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn round_trips() {
        let sealed = super::protect(b"AIza-test").unwrap();
        assert_ne!(sealed, b"AIza-test");
        assert_eq!(super::unprotect(&sealed).unwrap(), b"AIza-test");
    }
}
