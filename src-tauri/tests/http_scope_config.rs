#[test]
fn http_capability_allows_baidu_translate_endpoint() {
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
        .expect("HTTP 权限必须包含 URL 白名单");

    assert!(
        allow.iter().any(|url| {
            url.as_str() == Some("https://fanyi-api.baidu.com/api/trans/vip/translate")
        }),
        "HTTP 权限必须允许百度翻译接口"
    );
}
