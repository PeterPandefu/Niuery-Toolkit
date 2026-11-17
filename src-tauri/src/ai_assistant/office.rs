//! Built-in Office MCP servers backed by the downloadable `office` resource.
//! The engines ship as a resource pack (Node runtime + docx/excel/pptx servers
//! + xlsx sidecar); server entries are generated from the resolved pack path
//! so users never configure commands by hand.

use super::types::McpServer;
use crate::resources::{self, ResourceLease};
use std::{collections::BTreeMap, fs, path::Path, sync::Arc};
use tauri::Manager;

pub const RESOURCE_ID: &str = "office";

/// The engines hard-code a `.qoder-office-<format>-locks` directory next to
/// every saved document and never remove it. The pack is hash-verified, so
/// instead of patching it we preload this shim to relocate the lock directory
/// into the user temp dir and prune it after use.
const LOCK_REDIRECT_SCRIPT: &str = include_str!("office-lock-redirect.cjs");

struct ServerDef {
    name: &'static str,
    script: &'static str,
    /// The excel engine locates its native sidecar through $QODER_HOME/bin.
    home_env: bool,
}

const SERVERS: &[ServerDef] = &[
    ServerDef { name: "office-docx", script: "docx/server.cjs", home_env: false },
    ServerDef { name: "office-excel", script: "excel/server.cjs", home_env: true },
    ServerDef { name: "office-pptx", script: "pptx/server.cjs", home_env: false },
];

/// Read-only tools run without approval in Auto mode; every mutation still
/// goes through the per-call gate.
const READONLY_TOOLS: &[&str] = &[
    "load_guide",
    "read_context",
    "read_blocks",
    "read_range",
    "read_cells",
    "read_formats",
    "read_sheet_features",
    "aggregate_range",
    "find_cells",
    "read_cell_text",
    "read_slide",
    "check_document",
    "check_workbook",
    "check_deck",
];

/// Labels arrive sanitized (`mcp::sanitize` turns `-` into `_`).
pub fn is_office_server(label: &str) -> bool {
    matches!(label, "office_docx" | "office_excel" | "office_pptx")
}

pub fn is_readonly(server: &str, tool: &str) -> bool {
    is_office_server(server) && READONLY_TOOLS.contains(&tool)
}

pub fn build_servers(node: &Path, root: &Path, lock_redirect: &Path) -> Vec<McpServer> {
    // NODE_OPTIONS treats backslashes as escapes, so use forward slashes.
    let redirect = lock_redirect.to_string_lossy().replace('\\', "/");
    let node_options = format!("--require \"{redirect}\"");
    SERVERS
        .iter()
        .map(|def| {
            let mut env = BTreeMap::new();
            env.insert("NODE_OPTIONS".to_string(), node_options.clone());
            if def.home_env {
                env.insert("QODER_HOME".to_string(), root.to_string_lossy().into_owned());
            }
            McpServer {
                id: def.name.to_string(),
                name: def.name.to_string(),
                command: node.to_string_lossy().into_owned(),
                args: vec![root.join(def.script).to_string_lossy().into_owned()],
                env,
                enabled: true,
            }
        })
        .collect()
}

/// Materializes the lock-redirect shim outside the hash-verified pack so it
/// survives pack reinstallation.
fn ensure_lock_redirect(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("ai-assistant");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join("office-lock-redirect.cjs");
    let current = fs::read_to_string(&path).unwrap_or_default();
    if current != LOCK_REDIRECT_SCRIPT {
        fs::write(&path, LOCK_REDIRECT_SCRIPT).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

/// Returns the built-in servers plus a lease that blocks resource removal
/// while a generation is using them. None when the pack is not installed.
pub fn servers(app: &tauri::AppHandle) -> Option<(Vec<McpServer>, Arc<ResourceLease>)> {
    let lease = resources::lease(RESOURCE_ID).ok()?;
    let (node, _source) = resources::resolve(app, RESOURCE_ID).ok()?;
    let root = node.parent()?.to_path_buf();
    let lock_redirect = ensure_lock_redirect(app).ok()?;
    Some((build_servers(&node, &root, &lock_redirect), Arc::new(lease)))
}

/// Removes leftover `.qoder-office-*-locks` directories created by older
/// engine runs. Only lock files whose owning process is gone are deleted, and
/// a directory is removed only when nothing else remains inside.
pub fn sweep_lock_dirs(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
        if !path.is_dir()
            || !name.starts_with(".qoder-office-")
            || !name.ends_with("-locks")
        {
            continue;
        }
        clean_lock_dir(&path);
    }
}

fn clean_lock_dir(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else { return };
    let mut foreign = false;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            foreign = true;
            continue;
        };
        let stem = name.strip_suffix(".ticket").unwrap_or(name);
        match lock_owner_pid(stem) {
            Some(pid) if !process_alive(pid) => {
                let _ = fs::remove_file(&path);
            }
            Some(_) => {}
            None => foreign = true,
        }
    }
    if !foreign {
        let _ = fs::remove_dir(directory);
    }
}

/// Lock file names are `<sha256>-<pid>-<uuid>` (the uuid itself contains
/// dashes, so parse by fixed widths instead of splitting).
fn lock_owner_pid(name: &str) -> Option<u32> {
    let bytes = name.as_bytes();
    if bytes.len() < 64 + 1 + 1 + 1 + 36 {
        return None;
    }
    let key = &name[..64];
    if !key.bytes().all(|b| b.is_ascii_hexdigit()) || bytes[64] != b'-' {
        return None;
    }
    let uuid_start = bytes.len() - 36;
    if bytes[uuid_start - 1] != b'-' {
        return None;
    }
    let uuid = &name[uuid_start..];
    if !uuid.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return None;
    }
    name[65..uuid_start - 1].parse::<u32>().ok()
}

#[cfg(windows)]
fn process_alive(pid: u32) -> bool {
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(handle) => {
                let mut code = 0u32;
                let alive = GetExitCodeProcess(handle, &mut code).is_ok() && code == 259;
                let _ = windows::Win32::Foundation::CloseHandle(handle);
                alive
            }
            // ERROR_INVALID_PARAMETER means the pid no longer exists; any
            // other failure (e.g. access denied) is treated as alive. The
            // code arrives as an HRESULT, so keep only the Win32 low word.
            Err(error) => (error.code().0 as u32 & 0xFFFF) != 87,
        }
    }
}

#[cfg(not(windows))]
fn process_alive(_pid: u32) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn office_servers_point_at_pack_layout_and_gate_excel_home() {
        let root = Path::new("C:/data/resources-v1/office/1");
        let node = root.join("node.exe");
        let redirect = Path::new("C:/data/ai-assistant/office-lock-redirect.cjs");
        let servers = build_servers(&node, root, redirect);
        assert_eq!(servers.len(), 3);
        assert_eq!(servers[0].name, "office-docx");
        assert_eq!(servers[0].args, vec![root.join("docx/server.cjs").to_string_lossy()]);
        let excel = &servers[1];
        assert_eq!(excel.env.get("QODER_HOME").map(String::as_str), Some(root.to_string_lossy().as_ref()));
        assert_eq!(servers[2].name, "office-pptx");
        assert!(servers.iter().all(|server| server.enabled && server.command == node.to_string_lossy()));
        let expected_options = format!("--require \"{}\"", redirect.display());
        assert!(servers.iter().all(|server| server.env.get("NODE_OPTIONS").map(String::as_str) == Some(expected_options.as_str())));
    }

    #[test]
    fn office_readonly_classification_uses_sanitized_labels() {
        assert!(is_readonly("office_docx", "read_blocks"));
        assert!(is_readonly("office_excel", "read_cells"));
        assert!(is_readonly("office_pptx", "check_deck"));
        assert!(is_readonly("office_docx", "load_guide"));
        assert!(!is_readonly("office_docx", "save_document"));
        assert!(!is_readonly("office_excel", "apply_ops"));
        assert!(!is_readonly("office_pptx", "put_page"));
        assert!(!is_readonly("office-docx", "read_blocks"));
        assert!(!is_readonly("other_server", "read_blocks"));
    }

    #[test]
    fn lock_owner_pid_parses_engine_identity_only() {
        let key = "a".repeat(64);
        let uuid = "01234567-89ab-cdef-0123-456789abcdef";
        assert_eq!(lock_owner_pid(&format!("{key}-1234-{uuid}")), Some(1234));
        assert_eq!(lock_owner_pid(&format!("{key}-0-{uuid}")), Some(0));
        assert_eq!(lock_owner_pid(&format!("short-1234-{uuid}")), None);
        assert_eq!(lock_owner_pid(&format!("{key}-abc-{uuid}")), None);
        assert_eq!(lock_owner_pid(&format!("{key}-1234-not-a-uuid")), None);
        assert_eq!(lock_owner_pid(&format!("{key}-1234-{uuid}-extra")), None);
        assert_eq!(lock_owner_pid("random-file.txt"), None);
    }

    #[test]
    fn sweep_removes_dead_locks_and_empty_dirs_but_keeps_foreign_files() {
        let root = std::env::temp_dir().join(format!("office-sweep-test-{}", nanoid::nanoid!()));
        let locks = root.join(".qoder-office-docx-locks");
        fs::create_dir_all(&locks).unwrap();
        let key = "b".repeat(64);
        let uuid = "01234567-89ab-cdef-0123-456789abcdef";
        // PID 0 can never be opened as a live process, so it counts as dead.
        let dead = locks.join(format!("{key}-0-{uuid}"));
        fs::write(&dead, "1").unwrap();
        fs::write(format!("{}.ticket", dead.display()), "1").unwrap();
        sweep_lock_dirs(&root);
        assert!(!locks.exists(), "empty lock dir should be removed");

        let guarded = root.join(".qoder-office-xlsx-locks");
        fs::create_dir_all(&guarded).unwrap();
        fs::write(guarded.join("notes.txt"), "keep").unwrap();
        sweep_lock_dirs(&root);
        assert!(guarded.join("notes.txt").exists(), "foreign files must survive");

        let live = root.join(".qoder-office-pptx-locks");
        fs::create_dir_all(&live).unwrap();
        let own = live.join(format!("{key}-{}-{uuid}", std::process::id()));
        fs::write(&own, "1").unwrap();
        sweep_lock_dirs(&root);
        assert!(own.exists(), "live-process locks must survive");

        let _ = fs::remove_dir_all(&root);
    }
}