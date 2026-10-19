use super::types::*;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, String>;

pub fn safe_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 160
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("AI 数据标识无效，已拒绝访问目录外的文件".into());
    }
    Ok(())
}

fn safe_file(name: &str) -> Result<()> {
    let stem = name.strip_suffix(".json").ok_or("AI 数据文件名无效")?;
    if stem.is_empty()
        || name.len() > 260
        || !stem
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("AI 数据文件名无效".into());
    }
    Ok(())
}

fn io(error: std::io::Error) -> String {
    format!("AI 本地数据读写失败：{error}")
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn check_directory(path: &Path) -> Result<()> {
    if path.exists()
        && fs::symlink_metadata(path)
            .map_err(io)?
            .file_type()
            .is_symlink()
    {
        return Err("AI 数据目录不能为符号链接".into());
    }
    Ok(())
}

fn ensure(root: &Path) -> Result<()> {
    check_directory(root)?;
    fs::create_dir_all(root).map_err(io)?;
    for name in ["conversations", "attachments"] {
        let directory = root.join(name);
        check_directory(&directory)?;
        fs::create_dir_all(directory).map_err(io)?;
    }
    Ok(())
}

fn check_file(path: &Path) -> Result<()> {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("AI 数据文件不能为链接或目录".into());
        }
    }
    Ok(())
}

fn atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    check_file(path)?;
    let temporary = path.with_extension(format!("{}.tmp", nanoid::nanoid!()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(io)?;
        file.write_all(bytes).map_err(io)?;
        file.sync_all().map_err(io)?;
        drop(file);
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows::{
                core::PCWSTR,
                Win32::Storage::FileSystem::{
                    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
                },
            };
            let from: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
            let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            unsafe {
                MoveFileExW(
                    PCWSTR(from.as_ptr()),
                    PCWSTR(to.as_ptr()),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            }
            .map_err(|_| "AI 数据原子替换失败，原文件已保留".to_string())?;
        }
        #[cfg(not(windows))]
        fs::rename(&temporary, path).map_err(io)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Index {
    version: u32,
    workspace: Workspace,
    conversation_files: Vec<String>,
}

fn attachment_values(value: &mut Value) -> impl Iterator<Item = &mut Value> {
    value
        .get_mut("draftAttachments")
        .into_iter()
        .filter_map(Value::as_array_mut)
        .flatten()
}

fn write_attachments(
    root: &Path,
    items: &mut [Value],
    retained: &mut HashSet<PathBuf>,
) -> Result<()> {
    for item in items {
        let attachment: Attachment =
            serde_json::from_value(item.clone()).map_err(|_| "附件数据无效".to_string())?;
        let bytes = if attachment.kind == "image" {
            base64::engine::general_purpose::STANDARD
                .decode(&attachment.data)
                .map_err(|_| "图片附件编码无效".to_string())?
        } else {
            attachment.data.into_bytes()
        };
        let name = digest(&bytes);
        let path = root.join("attachments").join(&name);
        retained.insert(path.clone());
        check_file(&path)?;
        if !path.exists() {
            atomic(&path, &bytes)?;
        }
        let object = item.as_object_mut().ok_or("附件元数据无效")?;
        object.remove("data");
        object.insert("dataFile".into(), Value::String(name));
    }
    Ok(())
}

fn read_attachments(root: &Path, items: &mut [Value]) -> Result<()> {
    for item in items {
        let name = item
            .get("dataFile")
            .and_then(Value::as_str)
            .ok_or("附件副本路径缺失")?
            .to_string();
        safe_id(&name)?;
        let path = root.join("attachments").join(&name);
        check_file(&path)?;
        let bytes = fs::read(path).map_err(io)?;
        if digest(&bytes) != name {
            return Err("附件副本已损坏，原文件已保留".into());
        }
        let data = if item.get("kind").and_then(Value::as_str) == Some("image") {
            base64::engine::general_purpose::STANDARD.encode(bytes)
        } else {
            String::from_utf8(bytes).map_err(|_| "文本附件副本编码无效".to_string())?
        };
        let object = item.as_object_mut().ok_or("附件元数据无效")?;
        object.remove("dataFile");
        object.insert("data".into(), Value::String(data));
    }
    Ok(())
}

fn parse_conversation(root: &Path, bytes: &[u8]) -> Result<Conversation> {
    let mut value: Value = serde_json::from_slice(bytes).map_err(|_| "会话文件损坏".to_string())?;
    let draft: Vec<_> = attachment_values(&mut value).collect();
    for item in draft {
        read_attachments(root, std::slice::from_mut(item))?;
    }
    for message in value
        .get_mut("messages")
        .and_then(Value::as_array_mut)
        .ok_or("会话消息缺失")?
    {
        if let Some(items) = message.get_mut("attachments").and_then(Value::as_array_mut) {
            read_attachments(root, items)?;
        }
    }
    serde_json::from_value(value).map_err(|_| "会话数据格式无效或版本不兼容".into())
}

fn read_index(root: &Path, path: &Path) -> Result<Workspace> {
    check_file(path)?;
    let index: Index = serde_json::from_slice(&fs::read(path).map_err(io)?)
        .map_err(|_| "AI 数据索引损坏或版本不兼容".to_string())?;
    if index.version != 1 || index.workspace.version != 1 {
        return Err("AI 数据版本不受支持，原文件已保留".into());
    }
    let mut workspace = index.workspace;
    if !workspace.conversations.is_empty() {
        return Err("AI 数据索引结构无效".into());
    }
    for name in index.conversation_files {
        safe_file(&name)?;
        let path = root.join("conversations").join(&name);
        check_file(&path)?;
        let conversation = fs::read(&path)
            .map_err(io)
            .and_then(|bytes| parse_conversation(root, &bytes))
            .or_else(|_| {
                let backup = path.with_extension("bak.json");
                check_file(&backup)?;
                parse_conversation(root, &fs::read(backup).map_err(io)?)
            })?;
        workspace.conversations.push(conversation);
    }
    Ok(workspace)
}

pub fn load(root: &Path) -> Result<Option<Workspace>> {
    check_directory(root)?;
    check_directory(&root.join("conversations"))?;
    check_directory(&root.join("attachments"))?;
    let primary = root.join("workspace.json");
    let backup = root.join("workspace.bak.json");
    if !primary.exists() && !backup.exists() {
        return Ok(None);
    }
    // A newer version is valid data belonging to a newer application. Falling back
    // to an older backup here would allow the next save to silently downgrade it.
    for path in [&primary, &backup] {
        check_file(path)?;
        if let Ok(bytes) = fs::read(path) {
            if let Ok(index) = serde_json::from_slice::<Value>(&bytes) {
                if index
                    .get("version")
                    .and_then(Value::as_u64)
                    .is_some_and(|v| v != 1)
                    || index
                        .pointer("/workspace/version")
                        .and_then(Value::as_u64)
                        .is_some_and(|v| v != 1)
                {
                    return Err(
                        "AI 数据版本不受支持，原文件和备份已保留，请使用兼容版本打开".into(),
                    );
                }
            }
        }
    }
    read_index(root, &primary)
        .or_else(|_| read_index(root, &backup))
        .map(Some)
        .map_err(|_| {
            "AI 本地数据及备份无法恢复；原文件已保留。请打开数据目录进行恢复，或明确重置 AI 数据"
                .into()
        })
}

pub fn validate(workspace: &Workspace) -> Result<()> {
    if workspace.version != 1 {
        return Err("AI 数据版本不受支持".into());
    }
    let mut ids = HashSet::new();
    for conversation in &workspace.conversations {
        safe_id(&conversation.id)?;
        if !ids.insert(conversation.id.clone()) {
            return Err("会话标识重复".into());
        }
        super::protocol::validate_attachments(&conversation.draft_attachments)?;
        for message in &conversation.messages {
            super::protocol::validate_attachments(&message.attachments)?;
        }
    }
    for provider in &workspace.providers {
        super::protocol::validate_provider(&mut provider.clone())?;
    }
    Ok(())
}

pub fn save(root: &Path, workspace: &Workspace) -> Result<()> {
    validate(workspace)?;
    // Never overwrite a store whose primary and recoverable backup are both corrupt.
    let _ = load(root)?;
    ensure(root)?;
    let mut retained = HashSet::new();
    let mut files = Vec::new();
    for conversation in &workspace.conversations {
        let mut value =
            serde_json::to_value(conversation).map_err(|_| "会话序列化失败".to_string())?;
        if let Some(items) = value
            .get_mut("draftAttachments")
            .and_then(Value::as_array_mut)
        {
            write_attachments(root, items, &mut retained)?;
        }
        for message in value
            .get_mut("messages")
            .and_then(Value::as_array_mut)
            .ok_or("会话消息无效")?
        {
            if let Some(items) = message.get_mut("attachments").and_then(Value::as_array_mut) {
                write_attachments(root, items, &mut retained)?;
            }
        }
        let bytes = serde_json::to_vec(&value).map_err(|_| "会话序列化失败".to_string())?;
        let name = format!("{}-{}.json", conversation.id, digest(&bytes));
        let path = root.join("conversations").join(&name);
        let backup = path.with_extension("bak.json");
        retained.insert(path.clone());
        retained.insert(backup.clone());
        if !path.exists() {
            atomic(&path, &bytes)?;
        }
        if !backup.exists() {
            atomic(&backup, &bytes)?;
        }
        files.push(name);
    }
    let mut metadata = workspace.clone();
    metadata.conversations.clear();
    let bytes = serde_json::to_vec_pretty(&Index {
        version: 1,
        workspace: metadata,
        conversation_files: files,
    })
    .map_err(|_| "AI 数据索引序列化失败".to_string())?;
    let primary = root.join("workspace.json");
    if primary.exists() && read_index(root, &primary).is_err() {
        // Preserve the damaged index for manual inspection before a successful recovered save.
        fs::copy(
            &primary,
            root.join(format!("workspace-corrupt-{}.json", nanoid::nanoid!())),
        )
        .map_err(io)?;
    }
    atomic(&primary, &bytes)?;
    atomic(&root.join("workspace.bak.json"), &bytes)?;
    // Both manifests now reference the same live generation. Deleted history and exclusive
    // attachments can be reclaimed without making recovery restore intentionally deleted data.
    for folder in ["conversations", "attachments"] {
        for entry in fs::read_dir(root.join(folder)).map_err(io)? {
            let entry = entry.map_err(io)?;
            if entry.file_type().map_err(io)?.is_file() && !retained.contains(&entry.path()) {
                fs::remove_file(entry.path()).map_err(io)?;
            }
        }
    }
    Ok(())
}

pub fn reset(root: &Path) -> Result<()> {
    check_directory(root)?;
    if root.exists() {
        fs::remove_dir_all(root).map_err(io)?;
    }
    Ok(())
}
