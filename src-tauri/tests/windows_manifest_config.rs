//! 默认执行的构建配置回归检查，防止对话框清单参数再次污染主程序。

#[test]
fn dialog_manifest_link_args_are_scoped_to_examples_and_tests() {
    let source = include_str!("../build.rs");
    for prefix in ["cargo:", "cargo::"] {
        assert!(
            !source.contains(&format!("{prefix}rustc-link-arg=")),
            "禁止全局注入对话框清单参数：主程序的清单由 tauri_build 生成，重复嵌入会导致 CVT1100/LNK1123"
        );
    }
    for target in ["examples", "tests"] {
        assert!(
            source.contains(&format!("rustc-link-arg-{target}=/MANIFEST:EMBED")),
            "{target} 目标需要独立嵌入 Windows 清单"
        );
        assert!(
            source.contains(&format!("rustc-link-arg-{target}=/MANIFESTDEPENDENCY:")),
            "{target} 目标需要声明 Windows 通用控件 v6 依赖"
        );
    }
}
