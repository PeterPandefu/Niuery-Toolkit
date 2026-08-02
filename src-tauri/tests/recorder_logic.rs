use niuery_toolkit_lib::recorder::{
    build_ffmpeg_args, clamp_capture_rect, CaptureRect, CaptureTarget, RecordingAudioSettings,
    RecordingSettings, ffmpeg_resource_candidates, recording_elapsed_ms,
};
use std::path::Path;

fn settings() -> RecordingSettings {
    RecordingSettings {
        fps: 30,
        quality: "balanced".to_string(),
        countdown_sec: 3,
        cursor_highlight: true,
        audio: RecordingAudioSettings {
            microphone: false,
            system: false,
            microphone_id: None,
            system_id: None,
        },
    }
}

#[test]
fn clamps_region_to_monitor_bounds() {
    let result = clamp_capture_rect(
        CaptureRect { x: -50, y: 500, width: 400, height: 200 },
        0,
        0,
        300,
        600,
    );
    assert_eq!(result, CaptureRect { x: 0, y: 500, width: 300, height: 100 });
}

#[test]
fn builds_h264_rawvideo_arguments_with_balanced_quality() {
    let target = CaptureTarget {
        mode: "region".to_string(),
        monitor_id: Some("Primary".to_string()),
        window_id: None,
        rect: Some(CaptureRect { x: 12, y: 34, width: 1280, height: 720 }),
    };
    let args = build_ffmpeg_args(&target, &settings(), 1280, 720, "out.mp4");
    assert!(args.windows(2).any(|pair| pair == ["-f", "rawvideo"]));
    assert!(args.windows(2).any(|pair| pair == ["-crf", "22"]));
    assert!(args.windows(2).any(|pair| pair == ["-pix_fmt", "yuv420p"]));
    assert_eq!(args.last(), Some(&"out.mp4".to_string()));
}

#[test]
fn mixes_microphone_and_system_audio_when_both_sources_are_selected() {
    let target = CaptureTarget {
        mode: "monitor".to_string(),
        monitor_id: Some("Primary".to_string()),
        window_id: None,
        rect: None,
    };
    let mut settings = settings();
    settings.audio.microphone = true;
    settings.audio.microphone_id = Some("Microphone (USB)".to_string());
    settings.audio.system = true;
    settings.audio.system_id = Some("default".to_string());
    let args = build_ffmpeg_args(&target, &settings, 1280, 720, "out.mp4");
    assert!(args.windows(2).any(|pair| pair == ["-f", "dshow"]));
    assert!(args.windows(2).any(|pair| pair == ["-f", "wasapi"]));
    assert!(args.iter().any(|argument| argument.contains("amix=inputs=2")));
    assert!(args.windows(2).any(|pair| pair == ["-c:a", "aac"]));
}

#[test]
fn excludes_paused_intervals_from_recording_duration() {
    assert_eq!(recording_elapsed_ms(1_000, 5_000, None, 0), 4_000);
    assert_eq!(recording_elapsed_ms(1_000, 10_000, Some(5_000), 0), 4_000);
    assert_eq!(recording_elapsed_ms(1_000, 12_000, None, 5_000), 6_000);
}

#[test]
fn checks_the_tauri_resource_root_for_ffmpeg_before_legacy_nested_paths() {
    let candidates = ffmpeg_resource_candidates(Path::new("bundle-resources"));

    assert_eq!(candidates[0], Path::new("bundle-resources").join("ffmpeg.exe"));
    assert_eq!(candidates[1], Path::new("bundle-resources").join("resources").join("ffmpeg.exe"));
}
