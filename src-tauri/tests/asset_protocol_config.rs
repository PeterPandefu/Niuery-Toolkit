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

#[test]
fn content_security_policy_allows_recording_preview_blobs() {
    let html = include_str!("../../index.html");

    assert!(
        html.contains("media-src 'self' blob:"),
        "内容安全策略必须允许视频元素加载 blob 预览"
    );
    assert!(
        html.contains("connect-src 'self' blob:"),
        "内容安全策略必须允许读取 blob 预览数据"
    );
}
