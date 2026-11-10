#[test]
fn http_capability_allows_unrestricted_http_and_https_origins() {
    let capability: serde_json::Value =
        serde_json::from_str(include_str!("../capabilities/default.json"))
            .expect("默认能力配置必须是有效的 JSON");
    let permissions = capability["permissions"]
        .as_array()
        .expect("默认能力配置必须包含权限数组");

    let http_permission = permissions
        .iter()
        .find(|permission| permission["identifier"] == "http:default")
        .expect("默认能力配置必须包含 HTTP 权限");
    let allow = http_permission["allow"]
        .as_array()
        .expect("HTTP 权限必须包含 URL scope");

    for url in ["http://*:*", "https://*:*"] {
        assert!(
            allow.iter().any(|item| item.as_str() == Some(url)),
            "HTTP 权限必须允许 {url}"
        );
    }
}
