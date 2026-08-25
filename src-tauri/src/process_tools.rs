use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessTarget {
    pub pid: u32,
    pub creation_time: u64,
}

pub fn validate_port(port: u32) -> Result<u16, String> {
    u16::try_from(port)
        .ok()
        .filter(|value| *value != 0)
        .ok_or_else(|| "端口必须在 1 到 65535 之间".to_string())
}

pub fn matches_process_identity(target: &ProcessTarget, creation_time: u64) -> bool {
    target.creation_time == creation_time
}

pub fn is_protected_target(pid: u32, current_pid: u32, is_critical: bool) -> bool {
    pid == 0 || pid == 4 || pid == current_pid || is_critical
}

fn is_process_gone_hresult(code: u32) -> bool {
    code == 0x8007_0057
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortEndpoint {
    pub protocol: String,
    pub local_address: String,
    pub state: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessOwner {
    pub target: ProcessTarget,
    pub name: String,
    pub executable_path: Option<String>,
    pub endpoints: Vec<PortEndpoint>,
}

#[derive(Debug, Clone)]
struct PortRow {
    target: ProcessTarget,
    name: String,
    executable_path: Option<String>,
    protocol: String,
    local_address: String,
    state: Option<String>,
}

fn group_port_rows(rows: Vec<PortRow>) -> Vec<ProcessOwner> {
    let mut owners: Vec<ProcessOwner> = Vec::new();
    for row in rows {
        let endpoint = PortEndpoint {
            protocol: row.protocol,
            local_address: row.local_address,
            state: row.state,
        };
        if let Some(owner) = owners
            .iter_mut()
            .find(|owner| owner.target.pid == row.target.pid)
        {
            owner.endpoints.push(endpoint);
        } else {
            owners.push(ProcessOwner {
                target: row.target,
                name: row.name,
                executable_path: row.executable_path,
                endpoints: vec![endpoint],
            });
        }
    }
    owners
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminationStatus {
    Terminated,
    AlreadyExited,
    AccessDenied,
    Protected,
    IdentityChanged,
    Failed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessTerminationResult {
    pub pid: u32,
    pub status: TerminationStatus,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
enum AttemptOutcome {
    Terminated,
    AlreadyExited,
    AccessDenied,
    Protected,
    IdentityChanged,
    Failed(String),
}

fn map_termination_attempts(attempts: Vec<(u32, AttemptOutcome)>) -> Vec<ProcessTerminationResult> {
    attempts
        .into_iter()
        .map(|(pid, outcome)| {
            let (status, message) = match outcome {
                AttemptOutcome::Terminated => (TerminationStatus::Terminated, None),
                AttemptOutcome::AlreadyExited => (TerminationStatus::AlreadyExited, None),
                AttemptOutcome::AccessDenied => (TerminationStatus::AccessDenied, None),
                AttemptOutcome::Protected => (TerminationStatus::Protected, None),
                AttemptOutcome::IdentityChanged => (TerminationStatus::IdentityChanged, None),
                AttemptOutcome::Failed(message) => (TerminationStatus::Failed, Some(message)),
            };
            ProcessTerminationResult {
                pid,
                status,
                message,
            }
        })
        .collect()
}

fn canonical_regular_file(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("请选择要解除占用的文件".to_string());
    }
    let path = std::fs::canonicalize(path).map_err(|error| format!("无法访问文件: {error}"))?;
    if !path.is_file() {
        return Err("只能解除文件占用，不能选择文件夹".to_string());
    }
    Ok(path)
}

#[tauri::command]
pub fn find_port_owners(port: u32) -> Result<Vec<ProcessOwner>, String> {
    let port = validate_port(port)?;
    #[cfg(windows)]
    {
        let mut rows = windows_api::tcp_rows(port)?;
        rows.extend(windows_api::udp_rows(port)?);
        Ok(group_port_rows(rows))
    }
    #[cfg(not(windows))]
    {
        let _ = port;
        Err("该工具仅支持 Windows 桌面端".to_string())
    }
}

#[tauri::command]
pub fn find_file_lock_owners(path: String) -> Result<Vec<ProcessOwner>, String> {
    let path = canonical_regular_file(&path)?;
    #[cfg(windows)]
    {
        windows_api::restart_manager_owners(&path)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("该工具仅支持 Windows 桌面端".to_string())
    }
}

#[tauri::command]
pub fn terminate_processes(
    targets: Vec<ProcessTarget>,
) -> Result<Vec<ProcessTerminationResult>, String> {
    #[cfg(windows)]
    {
        Ok(targets
            .into_iter()
            .map(windows_api::terminate_target)
            .collect())
    }
    #[cfg(not(windows))]
    {
        let _ = targets;
        Err("该工具仅支持 Windows 桌面端".to_string())
    }
}

#[cfg(windows)]
mod windows_api {
    use super::*;
    use std::ffi::OsStr;
    use std::mem::size_of;
    use std::net::{Ipv4Addr, Ipv6Addr};
    use std::os::windows::ffi::OsStrExt;
    use std::slice;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{
        CloseHandle, BOOL, FILETIME, HANDLE, WAIT_OBJECT_0, WIN32_ERROR,
    };
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, GetExtendedUdpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID,
        MIB_UDP6ROW_OWNER_PID, MIB_UDPROW_OWNER_PID, TCP_TABLE_OWNER_PID_ALL, UDP_TABLE_OWNER_PID,
    };
    use windows::Win32::Networking::WinSock::{AF_INET, AF_INET6};
    use windows::Win32::System::RestartManager::{
        RmEndSession, RmGetList, RmRegisterResources, RmStartSession, CCH_RM_SESSION_KEY,
        RM_PROCESS_INFO,
    };
    use windows::Win32::System::Threading::{
        GetProcessTimes, IsProcessCritical, OpenProcess, QueryFullProcessImageNameW,
        TerminateProcess, WaitForSingleObject, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    };

    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
    const ERROR_MORE_DATA: u32 = 234;
    const WAIT_FOR_EXIT_MILLISECONDS: u32 = 5_000;

    struct ProcessHandle(HANDLE);

    impl Drop for ProcessHandle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    struct RestartManagerSession(u32);

    impl Drop for RestartManagerSession {
        fn drop(&mut self) {
            unsafe {
                let _ = RmEndSession(self.0);
            }
        }
    }

    pub fn tcp_rows(port: u16) -> Result<Vec<PortRow>, String> {
        let mut rows = tcp4_rows(port)?;
        rows.extend(tcp6_rows(port)?);
        Ok(rows)
    }

    pub fn udp_rows(port: u16) -> Result<Vec<PortRow>, String> {
        let mut rows = udp4_rows(port)?;
        rows.extend(udp6_rows(port)?);
        Ok(rows)
    }

    pub fn restart_manager_owners(path: &PathBuf) -> Result<Vec<ProcessOwner>, String> {
        let mut session_handle = 0_u32;
        let mut session_key = vec![0_u16; CCH_RM_SESSION_KEY as usize + 1];
        let status =
            unsafe { RmStartSession(&mut session_handle, 0, PWSTR(session_key.as_mut_ptr())) };
        ensure_success(status, "无法启动文件占用查询")?;
        let session = RestartManagerSession(session_handle);

        let path_wide = wide_path(path);
        let files = [PCWSTR(path_wide.as_ptr())];
        ensure_success(
            unsafe { RmRegisterResources(session.0, Some(&files), None, None) },
            "无法登记要查询的文件",
        )?;

        let mut needed = 0_u32;
        let mut count = 0_u32;
        let mut reboot_reasons = 0_u32;
        let first = unsafe {
            RmGetList(
                session.0,
                &mut needed,
                &mut count,
                None,
                &mut reboot_reasons,
            )
        };
        if first.0 == 0 {
            return Ok(Vec::new());
        }
        if first.0 != ERROR_MORE_DATA {
            return Err(format!("无法读取文件占用进程（Windows 错误 {}）", first.0));
        }

        let mut processes = vec![RM_PROCESS_INFO::default(); needed as usize];
        count = needed;
        let second = unsafe {
            RmGetList(
                session.0,
                &mut needed,
                &mut count,
                Some(processes.as_mut_ptr()),
                &mut reboot_reasons,
            )
        };
        ensure_success(second, "无法读取文件占用进程")?;
        processes.truncate(count as usize);
        Ok(processes
            .into_iter()
            .map(|process| {
                owner_for_pid(
                    process.Process.dwProcessId,
                    Some(filetime_value(process.Process.ProcessStartTime)),
                )
            })
            .collect())
    }

    pub fn terminate_target(target: ProcessTarget) -> ProcessTerminationResult {
        if is_protected_target(target.pid, std::process::id(), false) {
            return result(target.pid, AttemptOutcome::Protected);
        }
        let access = PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE;
        let handle = match unsafe { OpenProcess(access, false, target.pid) } {
            Ok(handle) => ProcessHandle(handle),
            Err(error) if is_access_denied(&error) => {
                return result(target.pid, AttemptOutcome::AccessDenied)
            }
            Err(error) if is_process_gone_hresult(error.code().0 as u32) => {
                return result(target.pid, AttemptOutcome::AlreadyExited)
            }
            Err(error) => {
                return result(
                    target.pid,
                    AttemptOutcome::Failed(format!("无法打开进程: {error}")),
                )
            }
        };
        let creation_time = match process_creation_time(handle.0) {
            Ok(creation_time) => creation_time,
            Err(error) => return result(target.pid, AttemptOutcome::Failed(error)),
        };
        if !matches_process_identity(&target, creation_time) {
            return result(target.pid, AttemptOutcome::IdentityChanged);
        }
        let mut critical = BOOL(0);
        if let Err(error) = unsafe { IsProcessCritical(handle.0, &mut critical) } {
            return result(
                target.pid,
                AttemptOutcome::Failed(format!("无法验证进程保护状态: {error}")),
            );
        }
        if is_protected_target(target.pid, std::process::id(), critical.as_bool()) {
            return result(target.pid, AttemptOutcome::Protected);
        }
        if let Err(error) = unsafe { TerminateProcess(handle.0, 1) } {
            return result(
                target.pid,
                AttemptOutcome::Failed(format!("结束进程失败: {error}")),
            );
        }
        if unsafe { WaitForSingleObject(handle.0, WAIT_FOR_EXIT_MILLISECONDS) } != WAIT_OBJECT_0 {
            return result(
                target.pid,
                AttemptOutcome::Failed("结束请求已发送，但等待进程退出超时".to_string()),
            );
        }
        result(target.pid, AttemptOutcome::Terminated)
    }

    fn result(pid: u32, outcome: AttemptOutcome) -> ProcessTerminationResult {
        map_termination_attempts(vec![(pid, outcome)])
            .into_iter()
            .next()
            .expect("单个终止结果必须存在")
    }

    fn tcp4_rows(port: u16) -> Result<Vec<PortRow>, String> {
        let rows = read_tcp_table(AF_INET.0 as u32)?;
        Ok(rows
            .iter()
            .filter(|row| port_from_network_value(row.dwLocalPort) == port)
            .map(|row| {
                port_row(
                    row.dwOwningPid,
                    "tcp",
                    format!("{}:{port}", Ipv4Addr::from(row.dwLocalAddr.to_ne_bytes())),
                    Some(tcp_state(row.dwState)),
                )
            })
            .collect())
    }

    fn tcp6_rows(port: u16) -> Result<Vec<PortRow>, String> {
        let rows = read_tcp6_table(AF_INET6.0 as u32)?;
        Ok(rows
            .iter()
            .filter(|row| port_from_network_value(row.dwLocalPort) == port)
            .map(|row| {
                port_row(
                    row.dwOwningPid,
                    "tcp",
                    format!("[{}]:{port}", Ipv6Addr::from(row.ucLocalAddr)),
                    Some(tcp_state(row.dwState)),
                )
            })
            .collect())
    }

    fn udp4_rows(port: u16) -> Result<Vec<PortRow>, String> {
        let rows = read_udp_table(AF_INET.0 as u32)?;
        Ok(rows
            .iter()
            .filter(|row| port_from_network_value(row.dwLocalPort) == port)
            .map(|row| {
                port_row(
                    row.dwOwningPid,
                    "udp",
                    format!("{}:{port}", Ipv4Addr::from(row.dwLocalAddr.to_ne_bytes())),
                    None,
                )
            })
            .collect())
    }

    fn udp6_rows(port: u16) -> Result<Vec<PortRow>, String> {
        let rows = read_udp6_table(AF_INET6.0 as u32)?;
        Ok(rows
            .iter()
            .filter(|row| port_from_network_value(row.dwLocalPort) == port)
            .map(|row| {
                port_row(
                    row.dwOwningPid,
                    "udp",
                    format!("[{}]:{port}", Ipv6Addr::from(row.ucLocalAddr)),
                    None,
                )
            })
            .collect())
    }

    fn port_row(pid: u32, protocol: &str, local_address: String, state: Option<String>) -> PortRow {
        let owner = owner_for_pid(pid, None);
        PortRow {
            target: owner.target,
            name: owner.name,
            executable_path: owner.executable_path,
            protocol: protocol.to_string(),
            local_address,
            state,
        }
    }

    fn owner_for_pid(pid: u32, known_creation_time: Option<u64>) -> ProcessOwner {
        match process_metadata(pid) {
            Ok((name, executable_path, creation_time)) => ProcessOwner {
                target: ProcessTarget {
                    pid,
                    creation_time: known_creation_time.unwrap_or(creation_time),
                },
                name,
                executable_path,
                endpoints: Vec::new(),
            },
            Err(_) => ProcessOwner {
                target: ProcessTarget {
                    pid,
                    creation_time: known_creation_time.unwrap_or(0),
                },
                name: format!("PID {pid}"),
                executable_path: None,
                endpoints: Vec::new(),
            },
        }
    }

    fn process_metadata(pid: u32) -> Result<(String, Option<String>, u64), String> {
        let handle = ProcessHandle(
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }
                .map_err(|error| format!("无法读取进程信息: {error}"))?,
        );
        let creation_time = process_creation_time(handle.0)?;
        let executable_path = process_image_path(handle.0).ok();
        let name = executable_path
            .as_deref()
            .and_then(|path| std::path::Path::new(path).file_name())
            .and_then(|name| name.to_str())
            .map(str::to_string)
            .unwrap_or_else(|| format!("PID {pid}"));
        Ok((name, executable_path, creation_time))
    }

    fn process_image_path(handle: HANDLE) -> Result<String, String> {
        let mut buffer = vec![0_u16; 32_768];
        let mut length = buffer.len() as u32;
        unsafe {
            QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_FORMAT(0),
                PWSTR(buffer.as_mut_ptr()),
                &mut length,
            )
        }
        .map_err(|error| format!("无法读取进程路径: {error}"))?;
        Ok(String::from_utf16_lossy(&buffer[..length as usize]))
    }

    fn process_creation_time(handle: HANDLE) -> Result<u64, String> {
        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) }
            .map_err(|error| format!("无法读取进程创建时间: {error}"))?;
        Ok(filetime_value(creation))
    }

    fn filetime_value(value: FILETIME) -> u64 {
        (u64::from(value.dwHighDateTime) << 32) | u64::from(value.dwLowDateTime)
    }

    fn tcp_state(value: u32) -> String {
        match value {
            1 => "closed",
            2 => "listen",
            3 => "syn-sent",
            4 => "syn-received",
            5 => "established",
            6 => "fin-wait-1",
            7 => "fin-wait-2",
            8 => "close-wait",
            9 => "closing",
            10 => "last-ack",
            11 => "time-wait",
            12 => "delete-tcb",
            _ => "unknown",
        }
        .to_string()
    }

    fn port_from_network_value(value: u32) -> u16 {
        u16::from_be(value as u16)
    }

    fn wide_path(path: &PathBuf) -> Vec<u16> {
        OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn ensure_success(status: WIN32_ERROR, action: &str) -> Result<(), String> {
        if status.0 == 0 {
            Ok(())
        } else {
            Err(format!("{action}（Windows 错误 {}）", status.0))
        }
    }

    fn is_access_denied(error: &windows::core::Error) -> bool {
        error.code().0 as u32 == 0x8007_0005
    }

    fn read_tcp_table(family: u32) -> Result<Vec<MIB_TCPROW_OWNER_PID>, String> {
        read_table(|buffer, size| unsafe {
            GetExtendedTcpTable(buffer, size, false, family, TCP_TABLE_OWNER_PID_ALL, 0)
        })
    }

    fn read_tcp6_table(family: u32) -> Result<Vec<MIB_TCP6ROW_OWNER_PID>, String> {
        read_table(|buffer, size| unsafe {
            GetExtendedTcpTable(buffer, size, false, family, TCP_TABLE_OWNER_PID_ALL, 0)
        })
    }

    fn read_udp_table(family: u32) -> Result<Vec<MIB_UDPROW_OWNER_PID>, String> {
        read_table(|buffer, size| unsafe {
            GetExtendedUdpTable(buffer, size, false, family, UDP_TABLE_OWNER_PID, 0)
        })
    }

    fn read_udp6_table(family: u32) -> Result<Vec<MIB_UDP6ROW_OWNER_PID>, String> {
        read_table(|buffer, size| unsafe {
            GetExtendedUdpTable(buffer, size, false, family, UDP_TABLE_OWNER_PID, 0)
        })
    }

    fn read_table<T: Copy>(
        query: impl Fn(Option<*mut core::ffi::c_void>, *mut u32) -> u32,
    ) -> Result<Vec<T>, String> {
        let mut byte_count = 0_u32;
        let first = query(None, &mut byte_count);
        if first != ERROR_INSUFFICIENT_BUFFER || byte_count < size_of::<u32>() as u32 {
            return Err(format!("无法读取端口占用信息（Windows 错误 {first}）"));
        }
        let mut buffer = vec![0_u32; (byte_count as usize).div_ceil(size_of::<u32>())];
        let second = query(Some(buffer.as_mut_ptr().cast()), &mut byte_count);
        if second != 0 {
            return Err(format!("无法读取端口占用信息（Windows 错误 {second}）"));
        }
        let count = unsafe { *buffer.as_ptr() } as usize;
        let available = (buffer.len() * size_of::<u32>() - size_of::<u32>()) / size_of::<T>();
        if count > available {
            return Err("端口占用信息格式无效".to_string());
        }
        let rows = unsafe {
            slice::from_raw_parts(
                buffer
                    .as_ptr()
                    .cast::<u8>()
                    .add(size_of::<u32>())
                    .cast::<T>(),
                count,
            )
        };
        Ok(rows.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(pid: u32, protocol: &str, local_address: &str, state: Option<&str>) -> PortRow {
        PortRow {
            target: ProcessTarget {
                pid,
                creation_time: 101,
            },
            name: "node.exe".into(),
            executable_path: Some(r"C:\\Program Files\\nodejs\\node.exe".into()),
            protocol: protocol.into(),
            local_address: local_address.into(),
            state: state.map(str::to_string),
        }
    }

    #[test]
    fn groups_tcp_and_udp_endpoints_for_the_same_process() {
        let owners = group_port_rows(vec![
            row(9527, "tcp", "127.0.0.1:8080", Some("listen")),
            row(9527, "udp", "0.0.0.0:8080", None),
        ]);

        assert_eq!(owners.len(), 1);
        assert_eq!(owners[0].target.pid, 9527);
        assert_eq!(owners[0].name, "node.exe");
        assert_eq!(owners[0].endpoints.len(), 2);
        assert_eq!(owners[0].endpoints[0].protocol, "tcp");
        assert_eq!(owners[0].endpoints[1].protocol, "udp");
    }

    #[test]
    fn preserves_each_termination_outcome() {
        let results = map_termination_attempts(vec![
            (9527, AttemptOutcome::IdentityChanged),
            (9528, AttemptOutcome::Terminated),
        ]);

        assert_eq!(results[0].status, TerminationStatus::IdentityChanged);
        assert_eq!(results[1].status, TerminationStatus::Terminated);
    }

    #[test]
    fn recognizes_an_invalid_process_id_as_already_exited() {
        assert!(is_process_gone_hresult(0x8007_0057));
        assert!(!is_process_gone_hresult(0x8007_0005));
    }

    #[cfg(windows)]
    #[test]
    fn finds_the_current_process_for_a_real_tcp_listener() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let owners = find_port_owners(u32::from(port)).unwrap();

        assert!(owners.iter().any(|owner| {
            owner.target.pid == std::process::id()
                && owner
                    .endpoints
                    .iter()
                    .any(|endpoint| endpoint.protocol == "tcp")
        }));
    }
}
