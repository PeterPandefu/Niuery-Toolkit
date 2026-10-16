use niuery_toolkit_lib::resources::{
    catalog::Resource,
    install::{install_archive, safe_relative},
};
use sha2::{Digest, Sha256};
use std::{fs, io::Write, sync::atomic::AtomicBool};

fn fixture(name: &str) -> (std::path::PathBuf, Resource) {
    let root = std::env::temp_dir().join(format!("niuery-resource-test-{}", nanoid::nanoid!()));
    fs::create_dir_all(&root).unwrap();
    let archive = root.join("pack.zip");
    let mut zip = zip::ZipWriter::new(fs::File::create(&archive).unwrap());
    zip.start_file(name, zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all(b"hello").unwrap();
    zip.finish().unwrap();
    let bytes = fs::read(&archive).unwrap();
    let resource = serde_json::from_value(serde_json::json!({
        "id":"ocr-eng", "version":"test", "platform":"any", "archive":"pack.zip", "entry":"eng.traineddata.gz",
        "sha256":format!("{:x}",Sha256::digest(&bytes)), "downloadBytes":bytes.len(), "installedBytes":5,
        "files":[{"path":"eng.traineddata.gz","bytes":5,"sha256":format!("{:x}",Sha256::digest(b"hello"))}]
    })).unwrap();
    (root, resource)
}

#[test]
fn rejects_cross_platform_and_windows_path_traversal() {
    for value in [
        "../escape",
        "C:/escape",
        "\\\\server\\share",
        "x/../../escape",
        "a\\..\\escape",
        "file:ads",
        "/root",
        "a/CON",
        "a/b.",
    ] {
        assert!(safe_relative(value).is_err(), "{value}");
    }
    assert!(safe_relative("core/engine.wasm").is_ok());
}

#[test]
fn installs_only_verified_bytes_and_preserves_previous_on_corruption() {
    let (root, mut resource) = fixture("eng.traineddata.gz");
    let dest = root.join("installed");
    let cancel = AtomicBool::new(false);
    install_archive(&root.join("pack.zip"), &dest, &resource, &cancel).unwrap();
    assert_eq!(fs::read(dest.join("eng.traineddata.gz")).unwrap(), b"hello");
    resource.sha256 = "0".repeat(64);
    assert!(install_archive(&root.join("pack.zip"), &dest, &resource, &cancel).is_err());
    assert_eq!(fs::read(dest.join("eng.traineddata.gz")).unwrap(), b"hello");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_malicious_archive_and_cancellation_without_touching_existing_data() {
    let (root, resource) = fixture("../escape");
    let dest = root.join("installed");
    assert!(install_archive(
        &root.join("pack.zip"),
        &dest,
        &resource,
        &AtomicBool::new(false)
    )
    .is_err());
    assert!(!root.join("escape").exists());
    assert!(install_archive(
        &root.join("pack.zip"),
        &dest,
        &resource,
        &AtomicBool::new(true)
    )
    .is_err());
    assert!(!dest.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_a_managed_directory_redirected_through_a_link() {
    let (root, resource) = fixture("eng.traineddata.gz");
    let outside = root.join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("eng.traineddata.gz"), b"hello").unwrap();
    let link = root.join("linked");
    #[cfg(windows)]
    {
        // Junction creation does not require Developer Mode or elevation.
        let result = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(result.status.success());
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, &link).unwrap();
    let checked = niuery_toolkit_lib::resources::install::verify_directory(&link, &resource);
    // Always unlink the junction before assertions/recursive fixture cleanup.
    #[cfg(windows)]
    fs::remove_dir(&link).unwrap();
    #[cfg(unix)]
    fs::remove_file(&link).unwrap();
    assert!(checked.is_err());
    assert_eq!(
        fs::read(outside.join("eng.traineddata.gz")).unwrap(),
        b"hello"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_runtime_validation_keeps_previous_installation() {
    use niuery_toolkit_lib::resources::install::install_archive_validated;
    let (root, resource) = fixture("eng.traineddata.gz");
    let dest = root.join("installed");
    fs::create_dir(&dest).unwrap();
    fs::write(dest.join("eng.traineddata.gz"), b"previous").unwrap();
    let result = install_archive_validated(
        &root.join("pack.zip"),
        &dest,
        &resource,
        &AtomicBool::new(false),
        |_| Err("incompatible runtime".into()),
    );
    assert!(result.is_err());
    assert_eq!(
        fs::read(dest.join("eng.traineddata.gz")).unwrap(),
        b"previous"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_unexpected_files_in_a_managed_executable_directory() {
    let (root, resource) = fixture("eng.traineddata.gz");
    let dest = root.join("installed");
    install_archive(&root.join("pack.zip"), &dest, &resource, &AtomicBool::new(false)).unwrap();
    fs::write(dest.join("version.dll"), b"unexpected injected library").unwrap();
    assert!(niuery_toolkit_lib::resources::install::verify_directory(&dest, &resource).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn resource_protocol_exposes_only_cataloged_ocr_files() {
    use niuery_toolkit_lib::resources::catalog::ocr_request;
    assert_eq!(
        ocr_request("/lang/eng.traineddata.gz").unwrap(),
        ("ocr-eng", "eng.traineddata.gz")
    );
    assert_eq!(
        ocr_request("/ocr-engine/core/tesseract-core-lstm.wasm.js").unwrap(),
        ("ocr-engine", "core/tesseract-core-lstm.wasm.js")
    );
    for path in [
        "/../config.json",
        "/ffmpeg/ffmpeg.exe",
        "/ocr-engine/../../config.json",
        "/lang/unknown.gz",
        "/ocr-engine/worker.min.js%00",
    ] {
        assert!(ocr_request(path).is_err(), "{path}");
    }
}

#[test]
#[ignore = "requires locally generated resource packs; run explicitly before distribution"]
fn generated_native_packs_pass_real_compatibility_checks() {
    use niuery_toolkit_lib::resources::{catalog, probe};
    let root = std::env::temp_dir().join(format!("niuery-native-packs-{}", nanoid::nanoid!()));
    fs::create_dir(&root).unwrap();
    let result = (|| -> Result<(), String> {
        for id in ["chromium", "ffmpeg", "java"] {
            let resource = catalog::resource(id)?;
            let archive = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../resource-packages")
                .join(&resource.archive);
            let dest = root.join(id);
            install_archive(&archive, &dest, resource, &AtomicBool::new(false))?;
            probe::validate(id, &dest.join(&resource.entry)).map_err(|e| format!("{id}: {e}"))?;
            niuery_toolkit_lib::resources::install::verify_directory(&dest, resource).map_err(|e| format!("{id} after compatibility check: {e}"))?;
        }
        Ok(())
    })();
    fs::remove_dir_all(root).unwrap();
    result.unwrap();
}
