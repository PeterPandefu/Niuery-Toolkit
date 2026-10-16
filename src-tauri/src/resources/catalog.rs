use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceFile {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: String,
    pub version: String,
    pub platform: String,
    pub archive: String,
    pub entry: String,
    pub sha256: String,
    pub download_bytes: u64,
    pub installed_bytes: u64,
    pub files: Vec<ResourceFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub schema_version: u32,
    pub release_base: String,
    pub resources: Vec<Resource>,
}

pub fn catalog() -> &'static Catalog {
    static CATALOG: std::sync::OnceLock<Catalog> = std::sync::OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../resource-catalog.json"))
            .expect("embedded resource catalog")
    })
}

pub fn resource(id: &str) -> Result<&'static Resource, String> {
    catalog()
        .resources
        .iter()
        .find(|r| r.id == id)
        .ok_or_else(|| "Unknown resource".into())
}

pub fn check_platform(resource: &Resource) -> Result<(), String> {
    if resource.platform == "any"
        || (resource.platform == "windows-x86_64" && cfg!(all(windows, target_arch = "x86_64")))
    {
        Ok(())
    } else {
        Err("This resource is not available for the current platform".into())
    }
}

pub fn ocr_request(path: &str) -> Result<(&'static str, &str), String> {
    let (id, file) = match path {
        "/lang/eng.traineddata.gz" => ("ocr-eng", "eng.traineddata.gz"),
        "/lang/chi_sim.traineddata.gz" => ("ocr-chi-sim", "chi_sim.traineddata.gz"),
        value => (
            "ocr-engine",
            value
                .strip_prefix("/ocr-engine/")
                .ok_or("Unknown OCR resource")?,
        ),
    };
    if !resource(id)?.files.iter().any(|entry| entry.path == file) {
        return Err("Unknown OCR resource file".into());
    }
    Ok((id, file))
}
