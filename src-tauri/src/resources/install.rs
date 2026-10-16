use super::catalog::Resource;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

pub fn safe_relative(value: &str) -> Result<PathBuf, String> {
    if value.is_empty() || value.contains(['\\', ':', '\0']) || value.starts_with('/') {
        return Err("Unsafe resource path".into());
    }
    for part in value.split('/') {
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.ends_with(['.', ' '])
            || part.chars().any(|c| c.is_control())
            || [
                "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
                "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
                "LPT9",
            ]
            .contains(&stem.as_str())
        {
            return Err("Unsafe resource path".into());
        }
    }
    Ok(PathBuf::from(value))
}

pub fn hash_file(path: &Path) -> Result<(u64, String), String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut bytes = 0;
    let mut buffer = [0; 64 * 1024];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        bytes += n as u64;
        hash.update(&buffer[..n]);
    }
    Ok((bytes, format!("{:x}", hash.finalize())))
}

pub fn verify_directory(root: &Path, resource: &Resource) -> Result<(), String> {
    reject_links(root)?;
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for item in fs::read_dir(directory).map_err(|e| e.to_string())? {
            let path = item.map_err(|e| e.to_string())?.path();
            reject_links(&path)?;
            if path.is_dir() { pending.push(path); }
            else {
                let relative = path.strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
                if !resource.files.iter().any(|entry| entry.path == relative) { return Err(format!("Unexpected managed resource file: {relative}")); }
            }
        }
    }
    for entry in &resource.files {
        let path = root.join(safe_relative(&entry.path)?);
        reject_links(&path)?;
        let (bytes, digest) = hash_file(&path)?;
        if bytes != entry.bytes || digest != entry.sha256 {
            return Err(format!("Resource file is corrupted: {}", entry.path));
        }
    }
    Ok(())
}

/// Do not follow junctions/reparse points, including in parent directories.
pub fn reject_links(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 {
                        return Err("Managed resource reparse points are not allowed".into());
                    }
                }
                if metadata.file_type().is_symlink() {
                    return Err("Managed resource links are not allowed".into());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

pub fn install_archive(
    archive: &Path,
    destination: &Path,
    resource: &Resource,
    cancel: &AtomicBool,
) -> Result<(), String> {
    install_archive_validated(archive, destination, resource, cancel, |_| Ok(()))
}

pub fn install_archive_validated(
    archive: &Path,
    destination: &Path,
    resource: &Resource,
    cancel: &AtomicBool,
    validate: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    reject_links(destination)?;
    let (bytes, digest) = hash_file(archive)?;
    if bytes != resource.download_bytes || digest != resource.sha256 {
        return Err("Resource SHA-256/size verification failed".into());
    }
    if cancel.load(Ordering::Acquire) {
        return Err("Download cancelled".into());
    }
    let parent = destination.parent().ok_or("Invalid resource destination")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let stage = parent.join(format!(".stage-{}", nanoid::nanoid!()));
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let result = (|| {
        let file = fs::File::open(archive).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        if zip.len() != resource.files.len() {
            return Err("Unexpected resource archive file count".into());
        }
        let mut seen = HashSet::new();
        for index in 0..zip.len() {
            if cancel.load(Ordering::Acquire) {
                return Err("Download cancelled".into());
            }
            let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
            let relative = safe_relative(entry.name())?;
            let key = entry.name().to_ascii_lowercase();
            if !seen.insert(key)
                || entry.is_dir()
                || entry
                    .unix_mode()
                    .map(|mode| mode & 0o170000 == 0o120000)
                    .unwrap_or(false)
            {
                return Err("Invalid or duplicate archive entry".into());
            }
            let expected = resource
                .files
                .iter()
                .find(|f| f.path == entry.name())
                .ok_or("Unexpected archive entry")?;
            if entry.size() != expected.bytes {
                return Err("Unexpected uncompressed resource size".into());
            }
            let target = stage.join(relative);
            fs::create_dir_all(target.parent().ok_or("Invalid archive path")?)
                .map_err(|e| e.to_string())?;
            let mut out = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(|e| e.to_string())?;
            let written = std::io::copy(&mut (&mut entry).take(expected.bytes + 1), &mut out)
                .map_err(|e| e.to_string())?;
            out.flush().map_err(|e| e.to_string())?;
            if written != expected.bytes {
                return Err("Resource extraction size mismatch".into());
            }
        }
        verify_directory(&stage, resource)?;
        validate(&stage.join(safe_relative(&resource.entry)?))?;
        if cancel.load(Ordering::Acquire) {
            return Err("Download cancelled".into());
        }
        let backup = parent.join(format!(".previous-{}", nanoid::nanoid!()));
        let had_previous = destination.exists();
        if had_previous {
            fs::rename(destination, &backup).map_err(|e| e.to_string())?;
        }
        if let Err(error) = fs::rename(&stage, destination) {
            if had_previous {
                let _ = fs::rename(&backup, destination);
            }
            return Err(error.to_string());
        }
        if had_previous {
            let _ = fs::remove_dir_all(backup);
        }
        Ok(())
    })();
    if stage.exists() {
        let _ = fs::remove_dir_all(stage);
    }
    result
}
