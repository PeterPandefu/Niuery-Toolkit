//! Built-in Office MCP servers backed by the downloadable `office` resource.
//! The engines ship as a resource pack (Node runtime + docx/excel/pptx servers
//! + xlsx sidecar); server entries are generated from the resolved pack path
//! so users never configure commands by hand.

use super::types::McpServer;
use crate::resources::{self, ResourceLease};
use std::{collections::BTreeMap, path::Path, sync::Arc};

pub const RESOURCE_ID: &str = "office";

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

pub fn build_servers(node: &Path, root: &Path) -> Vec<McpServer> {
    SERVERS
        .iter()
        .map(|def| {
            let mut env = BTreeMap::new();
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

/// Returns the built-in servers plus a lease that blocks resource removal
/// while a generation is using them. None when the pack is not installed.
pub fn servers(app: &tauri::AppHandle) -> Option<(Vec<McpServer>, Arc<ResourceLease>)> {
    let lease = resources::lease(RESOURCE_ID).ok()?;
    let (node, _source) = resources::resolve(app, RESOURCE_ID).ok()?;
    let root = node.parent()?.to_path_buf();
    Some((build_servers(&node, &root), Arc::new(lease)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn office_servers_point_at_pack_layout_and_gate_excel_home() {
        let root = Path::new("C:/data/resources-v1/office/1");
        let node = root.join("node.exe");
        let servers = build_servers(&node, root);
        assert_eq!(servers.len(), 3);
        assert_eq!(servers[0].name, "office-docx");
        assert!(servers[0].env.is_empty());
        assert_eq!(servers[0].args, vec![root.join("docx/server.cjs").to_string_lossy()]);
        let excel = &servers[1];
        assert_eq!(excel.env.get("QODER_HOME").map(String::as_str), Some(root.to_string_lossy().as_ref()));
        assert_eq!(servers[2].name, "office-pptx");
        assert!(servers.iter().all(|server| server.enabled && server.command == node.to_string_lossy()));
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
}