use image::{Rgb, RgbImage};
use niuery_toolkit_lib::wallpaper::{
    bing_archive_url, build_ai_image_url, encode_jpeg, encode_path_segment, parse_bing_archive,
    parse_wallhaven_search, sanitize_ai_model, sanitize_filename, strip_ai_watermark,
    wallhaven_search_url, watermark_crop_rect, with_no_watermark_prompt, WATERMARK_BOTTOM_FRACTION,
};

#[test]
fn sanitizes_filename_and_falls_back_when_empty() {
    assert_eq!(sanitize_filename("Rainy Tokyo Night"), "Rainy_Tokyo_Night");
    assert_eq!(sanitize_filename("雨夜东京"), "雨夜东京");
    assert_eq!(sanitize_filename("???"), "wallpaper");
    assert_eq!(sanitize_filename(""), "wallpaper");
    let long = "a".repeat(80);
    assert_eq!(sanitize_filename(&long).len(), 60);
}

#[test]
fn percent_encodes_prompt_path_segments() {
    assert_eq!(encode_path_segment("hello world"), "hello%20world");
    assert_eq!(encode_path_segment("云海"), "%E4%BA%91%E6%B5%B7");
}

#[test]
fn bing_archive_url_pages_by_eight() {
    assert!(bing_archive_url(1).contains("idx=0"));
    assert!(bing_archive_url(2).contains("idx=8"));
    assert!(bing_archive_url(0).contains("idx=0"));
}

#[test]
fn wallhaven_search_url_uses_toplist_when_query_empty() {
    let empty = wallhaven_search_url("  ", 1);
    assert!(empty.contains("sorting=toplist"));
    assert!(empty.contains("purity=100"));
    let searched = wallhaven_search_url("nature landscape", 3);
    assert!(searched.contains("q=nature%20landscape"));
    assert!(searched.contains("page=3"));
    assert!(searched.contains("sorting=relevance"));
}

#[test]
fn ai_url_always_disables_logo_and_clamps_model() {
    let url = build_ai_image_url("forest", 1920, 1080, "unknown-model", 42);
    assert!(url.starts_with("https://image.pollinations.ai/prompt/"));
    assert!(url.contains("nologo=true"));
    assert!(url.contains("private=true"));
    assert!(url.contains("model=flux"));
    assert!(url.contains("seed=42"));
    assert_eq!(sanitize_ai_model("flux-anime"), "flux-anime");
    assert_eq!(sanitize_ai_model("turbo"), "turbo");
    assert!(with_no_watermark_prompt("forest").contains("no watermark"));
}

#[test]
fn watermark_crop_drops_the_bottom_fraction() {
    let (_, _, width, height) = watermark_crop_rect(1920, 1080);
    assert_eq!(width, 1920);
    let expected = ((1080.0_f32) * (1.0 - WATERMARK_BOTTOM_FRACTION)).round() as u32;
    assert_eq!(height, expected);
    assert!(height < 1080);
}

#[test]
fn strip_ai_watermark_restores_original_size_as_jpeg() {
    let mut img = RgbImage::new(40, 40);
    for pixel in img.pixels_mut() {
        *pixel = Rgb([200, 10, 10]);
    }
    for y in 38..40 {
        for x in 0..40 {
            img.put_pixel(x, y, Rgb([12, 12, 220]));
        }
    }
    let png = encode_jpeg(&image::DynamicImage::ImageRgb8(img), 90).expect("encode source");
    let stripped = strip_ai_watermark(&png).expect("strip watermark");
    let decoded = image::load_from_memory(&stripped).expect("decode jpeg");
    assert_eq!(decoded.width(), 40);
    assert_eq!(decoded.height(), 40);
    assert!(stripped.starts_with(&[0xFF, 0xD8]));
}

#[test]
fn parses_bing_archive_into_uhd_urls() {
    let json = r#"{
        "images": [
            {
                "url": "/th?id=OHR_Forest_1920x1080.jpg",
                "urlbase": "/th?id=OHR_Forest",
                "copyright": "Forest (Photographer)",
                "title": "Morning Forest"
            }
        ]
    }"#;
    let items = parse_bing_archive(json).expect("parse bing");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].title, "Morning Forest");
    assert_eq!(items[0].source, "bing");
    assert_eq!(items[0].full_url, "https://www.bing.com/th?id=OHR_Forest_UHD.jpg");
    assert!(items[0].thumb_url.contains("OHR_Forest_1920x1080"));
}

#[test]
fn parses_wallhaven_search_results() {
    let json = r#"{
        "data": [
            {
                "id": "85k6j2",
                "path": "https://w.wallhaven.cc/full/85/wallhaven-85k6j2.jpg",
                "dimension_x": 3840,
                "dimension_y": 2160,
                "thumbs": { "large": "https://th.wallhaven.cc/lg/85/85k6j2.jpg" }
            }
        ]
    }"#;
    let items = parse_wallhaven_search(json).expect("parse wallhaven");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, "85k6j2");
    assert_eq!(items[0].width, 3840);
    assert!(items[0].full_url.contains("wallhaven-85k6j2.jpg"));
}
