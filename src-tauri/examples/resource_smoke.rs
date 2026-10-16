//! Explicit local smoke test, never part of the distributed app.
//! Requires `npm run resources:pack` and the Vite dev server on port 21516.
//! Run: cargo run --offline --example resource_smoke
use niuery_toolkit_lib::resources;
use serde::Serialize;
use std::{fs, path::PathBuf, sync::atomic::AtomicBool};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SmokeSetup {
    root: String,
}

#[tauri::command]
async fn prepare_smoke(app: tauri::AppHandle) -> Result<SmokeSetup, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = resources::root(&app)?;
        for id in ["ocr-engine", "ocr-chi-sim", "ocr-eng"] {
            let resource = resources::catalog::resource(id)?;
            let archive = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../resource-packages")
                .join(&resource.archive);
            resources::install::install_archive(
                &archive,
                &root.join(id).join(&resource.version),
                resource,
                &AtomicBool::new(false),
            )?;
        }
        Ok(SmokeSetup {
            root: root.to_string_lossy().into(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn finish_smoke(app: tauri::AppHandle, result: String, success: bool) {
    println!("RESOURCE_SMOKE_RESULT:{result}");
    // Retain the synthetic report for inspection; no user data is involved.
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../resource-packages/webview2-smoke-result.json");
    let _ = fs::write(path, result);
    app.exit(if success { 0 } else { 1 });
}

fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "com.niuery.resource-smoke".into();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("resource", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                let response = match resources::read_ocr_asset(&app, request.uri().path()) {
                    Ok((bytes, mime)) => tauri::http::Response::builder()
                        .header("Content-Type", mime)
                        .header("Access-Control-Allow-Origin", "*")
                        .header("X-Content-Type-Options", "nosniff")
                        .body(bytes)
                        .unwrap(),
                    Err(error) => {
                        eprintln!("OCR asset: {error}");
                        tauri::http::Response::builder()
                            .status(404)
                            .header("Access-Control-Allow-Origin", "*")
                            .body(Vec::new())
                            .unwrap()
                    }
                };
                responder.respond(response);
            });
        })
        .invoke_handler(tauri::generate_handler![
            prepare_smoke,
            finish_smoke,
            resources::get_resource_paths,
            resources::list_resources,
            resources::get_resource_mirror
        ])
        .setup(|app| {
            let page = if std::env::var_os("NIUERY_RESOURCE_SMOKE_UI").is_some() { "resource-manager-smoke.html" } else { "resource-smoke.html" };
            let url = format!("http://localhost:21516/src-tauri/tests/fixtures/{page}").parse().unwrap();
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(url),
            )
            .title("Niuery Resource Smoke Test")
            .inner_size(900.0, 650.0)
            .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(100));
                handle.exit(2);
            });
            Ok(())
        })
        .run(context)
        .expect("resource smoke app");
}
