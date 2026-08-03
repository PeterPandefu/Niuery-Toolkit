#[test]
fn asset_protocol_allows_recording_files_from_the_app_cache() {
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .expect("tauri configuration must be valid JSON");
    let scope = config["app"]["security"]["assetProtocol"]["scope"]
        .as_array()
        .expect("asset protocol scope must be an array");

    assert!(
        scope
            .iter()
            .any(|entry| entry.as_str() == Some("$APPCACHE/**")),
        "recording artifacts are stored in app_cache_dir and must be readable via asset://"
    );
}
