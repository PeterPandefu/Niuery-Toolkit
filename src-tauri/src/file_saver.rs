/// 通用文件保存：弹出系统保存对话框，将字节流写入用户选择的路径。
/// 前端处理结果（PDF / 图片 / zip 等）统一通过该命令落盘。
#[tauri::command]
pub fn save_file_dialog(
    bytes: Vec<u8>,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let ext_refs: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    let path = rfd::FileDialog::new()
        .add_filter(&filter_name, &ext_refs)
        .set_file_name(&default_name)
        .save_file();

    match path {
        Some(path) => {
            std::fs::write(&path, &bytes).map_err(|e| format!("保存失败: {e}"))?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}
