//! Optional human confirmation before signing/submitting from the host.

/// Confirm a send/sign action. Returns `true` if allowed.
///
/// - On Windows: MessageBox OK/Cancel when `require_os_confirm` is true.
/// - Elsewhere: prints to stderr and requires env `VIREON_HOST_CONFIRM=1` for non-interactive
///   JSONL, or auto-allows when OS confirm is disabled (extension should confirm in UI).
pub fn confirm_send(require_os_confirm: bool, summary: &str) -> Result<(), String> {
    if !require_os_confirm {
        return Ok(());
    }

    #[cfg(windows)]
    {
        windows_confirm("Vireon browser host", summary)
    }

    #[cfg(not(windows))]
    {
        eprintln!("vireon-browser-host confirm required:\n{summary}");
        eprintln!("Set VIREON_HOST_CONFIRM=1 to allow this action in non-GUI environments.");
        match std::env::var("VIREON_HOST_CONFIRM") {
            Ok(value)
                if value == "1"
                    || value.eq_ignore_ascii_case("true")
                    || value.eq_ignore_ascii_case("yes") =>
            {
                Ok(())
            }
            _ => Err(
                "send/sign blocked: OS confirm enabled and VIREON_HOST_CONFIRM is not set"
                    .to_owned(),
            ),
        }
    }
}

#[cfg(windows)]
fn windows_confirm(title: &str, body: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    const MB_OKCANCEL: u32 = 0x0000_0001;
    const MB_ICONWARNING: u32 = 0x0000_0030;
    const MB_SETFOREGROUND: u32 = 0x0001_0000;
    const IDOK: i32 = 1;

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(
            hwnd: *mut core::ffi::c_void,
            text: *const u16,
            caption: *const u16,
            flags: u32,
        ) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let text = wide(body);
    let caption = wide(title);
    // SAFETY: MessageBoxW with null HWND and NUL-terminated UTF-16 strings.
    let result = unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            MB_OKCANCEL | MB_ICONWARNING | MB_SETFOREGROUND,
        )
    };
    if result == IDOK {
        Ok(())
    } else {
        Err("user cancelled send/sign confirmation".to_owned())
    }
}
