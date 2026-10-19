//! Keys only cross IPC on explicit edits; storage never receives their value.
#[cfg(windows)]
mod platform {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::ERROR_NOT_FOUND;
    use windows::Win32::Security::Credentials::*;

    fn target(namespace: &str, id: &str) -> Vec<u16> {
        format!("NiueryToolkit/{namespace}/ai-assistant/{id}\0")
            .encode_utf16()
            .collect()
    }
    pub fn read(namespace: &str, id: &str) -> Result<Option<String>, String> {
        let name = target(namespace, id);
        let mut credential = std::ptr::null_mut();
        unsafe {
            match CredReadW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, 0, &mut credential) {
                Err(error) if error.code() == ERROR_NOT_FOUND.to_hresult() => Ok(None),
                Err(_) => Err("无法读取 Windows 系统凭据，请检查凭据管理器".into()),
                Ok(()) => {
                    let item = &*credential;
                    let bytes = if item.CredentialBlobSize == 0 {
                        &[][..]
                    } else {
                        std::slice::from_raw_parts(
                            item.CredentialBlob,
                            item.CredentialBlobSize as usize,
                        )
                    };
                    let result = String::from_utf8(bytes.to_vec())
                        .map(Some)
                        .map_err(|_| "系统凭据编码无效".to_string());
                    CredFree(credential.cast());
                    result
                }
            }
        }
    }
    pub fn write(namespace: &str, id: &str, key: &str) -> Result<(), String> {
        if key.len() > 2560 {
            return Err("API Key 超过 Windows 凭据长度限制".into());
        }
        let mut name = target(namespace, id);
        let mut user: Vec<u16> = "NiueryToolkit\0".encode_utf16().collect();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(name.as_mut_ptr()),
            CredentialBlobSize: key.len() as u32,
            CredentialBlob: key.as_ptr() as *mut u8,
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR(user.as_mut_ptr()),
            ..Default::default()
        };
        unsafe { CredWriteW(&credential, 0) }
            .map_err(|_| "无法保存 Windows 系统凭据，API Key 未写入文件".into())
    }
    pub fn remove(namespace: &str, id: &str) -> Result<(), String> {
        let name = target(namespace, id);
        match unsafe { CredDeleteW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, 0) } {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ERROR_NOT_FOUND.to_hresult() => Ok(()),
            Err(_) => Err("无法删除 Windows 系统凭据".into()),
        }
    }
    pub fn remove_all(namespace: &str) -> Result<(), String> {
        let filter: Vec<u16> = format!("NiueryToolkit/{namespace}/ai-assistant/*\0")
            .encode_utf16()
            .collect();
        let mut count = 0;
        let mut credentials = std::ptr::null_mut();
        unsafe {
            match CredEnumerateW(
                PCWSTR(filter.as_ptr()),
                CRED_ENUMERATE_FLAGS(0),
                &mut count,
                &mut credentials,
            ) {
                Err(error) if error.code() == ERROR_NOT_FOUND.to_hresult() => return Ok(()),
                Err(_) => return Err("无法枚举 AI 助手系统凭据，数据未重置".into()),
                Ok(()) => (),
            }
            let mut failed = false;
            for pointer in std::slice::from_raw_parts(credentials, count as usize) {
                if CredDeleteW((*(*pointer)).TargetName, CRED_TYPE_GENERIC, 0).is_err() {
                    failed = true;
                }
            }
            CredFree(credentials.cast());
            if failed {
                return Err("部分 AI 助手系统凭据删除失败，请检查 Windows 凭据管理器后重试".into());
            }
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn read(_: &str, _: &str) -> Result<Option<String>, String> {
        Err("当前平台尚不支持 AI 助手系统凭据；不会使用明文文件保存密钥".into())
    }
    pub fn write(_: &str, _: &str, _: &str) -> Result<(), String> {
        Err("当前平台尚不支持 AI 助手系统凭据；不会使用明文文件保存密钥".into())
    }
    pub fn remove(_: &str, _: &str) -> Result<(), String> {
        Err("当前平台尚不支持 AI 助手系统凭据".into())
    }
    pub fn remove_all(_: &str) -> Result<(), String> {
        Err("当前平台尚不支持 AI 助手系统凭据，无法确认密钥清理".into())
    }
}
pub use platform::*;
