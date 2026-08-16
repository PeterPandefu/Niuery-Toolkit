use niuery_toolkit_lib::recorder::{
    build_ffmpeg_args, build_ffmpeg_args_for_encoder, build_gdigrab_ffmpeg_args,
    clamp_capture_rect, concat_recording_segments, ffmpeg_resource_candidates,
    parse_ffmpeg_progress_fps, recording_elapsed_ms, CaptureRect, CaptureTarget,
    RecordingAudioSettings, RecordingFrameScheduler, RecordingSettings,
};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

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
        CaptureRect {
            x: -50,
            y: 500,
            width: 400,
            height: 200,
        },
        0,
        0,
        300,
        600,
    );
    assert_eq!(
        result,
        CaptureRect {
            x: 0,
            y: 500,
            width: 300,
            height: 100
        }
    );
}

#[test]
fn builds_h264_rawvideo_arguments_with_balanced_quality() {
    let target = CaptureTarget {
        mode: "region".to_string(),
        monitor_id: Some("Primary".to_string()),
        window_id: None,
        rect: Some(CaptureRect {
            x: 12,
            y: 34,
            width: 1280,
            height: 720,
        }),
    };
    let args = build_ffmpeg_args(&target, &settings(), 1280, 720, "out.mp4");
    assert!(args.windows(2).any(|pair| pair == ["-f", "rawvideo"]));
    assert!(args.windows(2).any(|pair| pair == ["-crf", "22"]));
    assert!(args.windows(2).any(|pair| pair == ["-pix_fmt", "yuv420p"]));
    assert_eq!(args.last(), Some(&"out.mp4".to_string()));
}

#[test]
fn fps_and_quality_profiles_change_the_sampling_and_h264_encoder_arguments() {
    let target = CaptureTarget {
        mode: "monitor".to_string(),
        monitor_id: Some("Primary".to_string()),
        window_id: None,
        rect: None,
    };
    let mut high = settings();
    high.fps = 60;
    high.quality = "high".to_string();
    let mut small = settings();
    small.fps = 15;
    small.quality = "small".to_string();

    let high_args = build_ffmpeg_args_for_encoder(&target, &high, 1280, 720, "high.mp4", "h264_mf");
    let small_args =
        build_ffmpeg_args_for_encoder(&target, &small, 1280, 720, "small.mp4", "h264_mf");
    let openh264_args =
        build_ffmpeg_args_for_encoder(&target, &high, 1280, 720, "openh264.mp4", "libopenh264");

    assert!(high_args
        .windows(2)
        .any(|pair| pair == ["-framerate", "60"]));
    assert!(small_args
        .windows(2)
        .any(|pair| pair == ["-framerate", "15"]));
    assert!(high_args.windows(2).any(|pair| pair == ["-b:v", "16M"]));
    assert!(small_args.windows(2).any(|pair| pair == ["-b:v", "3M"]));
    assert!(openh264_args
        .windows(2)
        .any(|pair| pair == ["-c:v", "libopenh264"]));
    assert!(openh264_args.windows(2).any(|pair| pair == ["-b:v", "16M"]));
}

#[test]
fn native_gdigrab_path_keeps_60fps_frames_inside_ffmpeg() {
    let mut high = settings();
    high.fps = 60;
    high.quality = "high".to_string();
    let args = build_gdigrab_ffmpeg_args(
        &high,
        &CaptureRect {
            x: 120,
            y: 80,
            width: 1920,
            height: 1440,
        },
        "out.mp4",
        "h264_mf",
    );

    assert!(args.windows(2).any(|pair| pair == ["-f", "gdigrab"]));
    assert!(args.windows(2).any(|pair| pair == ["-framerate", "60"]));
    assert!(args.windows(2).any(|pair| pair == ["-draw_mouse", "1"]));
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-video_size", "1920x1440"]));
    assert!(args.windows(2).any(|pair| pair == ["-offset_x", "120"]));
    assert!(args.windows(2).any(|pair| pair == ["-offset_y", "80"]));
    assert!(args.windows(2).any(|pair| pair == ["-b:v", "16M"]));
    assert!(!args.iter().any(|argument| argument == "pipe:0"));
}

#[test]
fn reads_actual_fps_from_ffmpeg_structured_progress() {
    let progress = "frame=95\nout_time_us=2000000\nprogress=end\n";
    assert_eq!(parse_ffmpeg_progress_fps(progress), Some(48));
    assert_eq!(
        parse_ffmpeg_progress_fps("frame=0\nout_time_us=0\n"),
        Some(0)
    );
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
    assert!(args
        .iter()
        .any(|argument| argument.contains("amix=inputs=2")));
    assert!(args.windows(2).any(|pair| pair == ["-c:a", "aac"]));
    assert!(args.iter().any(|argument| argument == "-shortest"));
}

#[test]
fn bundled_ffmpeg_exits_after_video_pipe_eof_with_continuous_audio() {
    let ffmpeg = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("ffmpeg.exe");
    let output = std::env::temp_dir().join(format!("niuery-audio-eof-{}.mp4", std::process::id()));
    let started = Instant::now();
    let mut child = Command::new(ffmpeg)
        .args([
            "-y",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-video_size",
            "2x2",
            "-framerate",
            "1",
            "-i",
            "pipe:0",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000",
            "-c:v",
            "mpeg4",
            "-c:a",
            "aac",
            "-shortest",
        ])
        .arg(&output)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("应能启动随附 FFmpeg");
    child
        .stdin
        .as_mut()
        .expect("应有视频输入")
        .write_all(&[0; 16])
        .expect("应能写入单帧 RGBA");
    drop(child.stdin.take());
    let status = child.wait().expect("视频 EOF 后 FFmpeg 应及时退出");
    let elapsed = started.elapsed();
    let valid_output = std::fs::metadata(&output)
        .map(|metadata| metadata.len() > 0)
        .unwrap_or(false);
    let _ = std::fs::remove_file(&output);
    assert!(status.success());
    assert!(
        elapsed < Duration::from_secs(5),
        "持续音频不能阻塞视频片段结束"
    );
    assert!(valid_output, "EOF 后生成的音视频片段仍应有效");
}

#[test]
fn excludes_paused_intervals_from_recording_duration() {
    assert_eq!(recording_elapsed_ms(1_000, 5_000, None, 0), 4_000);
    assert_eq!(recording_elapsed_ms(1_000, 10_000, Some(5_000), 0), 4_000);
    assert_eq!(recording_elapsed_ms(1_000, 12_000, None, 5_000), 6_000);
}

#[test]
fn preserves_complete_loop_timing_with_variable_frame_rate_input() {
    // 首帧捕获虽快，但每个完整循环（包括 pipe 写入背压）为 333ms。实时 PTS + VFR
    // 必须据此生成约 3fps 的视频；旧 rawvideo 固定 30fps 会把 60 帧压缩成约 2 秒。
    let target = CaptureTarget {
        mode: "monitor".to_string(),
        monitor_id: Some("Primary".to_string()),
        window_id: None,
        rect: None,
    };
    let args = build_ffmpeg_args(&target, &settings(), 1280, 720, "out.mp4");
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-use_wallclock_as_timestamps", "1"]));
    assert!(args.windows(2).any(|pair| pair == ["-fps_mode", "vfr"]));

    let mut scheduler = RecordingFrameScheduler::new();
    for _ in 0..60 {
        assert!(scheduler.should_write_captured_frame(false, false));
        scheduler.record_written_frame();
    }
    assert_eq!(scheduler.written_frames(), 60);
    assert_eq!(scheduler.actual_fps(20_000), 3);
}

#[test]
fn bundled_ffmpeg_accepts_the_variable_frame_rate_option() {
    let ffmpeg = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("ffmpeg.exe");
    let output = std::env::temp_dir().join(format!("niuery-fps-mode-{}.mp4", std::process::id()));
    let status = Command::new(ffmpeg)
        .args([
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=size=16x16:rate=1",
            "-frames:v",
            "1",
            "-fps_mode",
            "vfr",
            "-c:v",
            "mpeg4",
        ])
        .arg(&output)
        .status()
        .expect("应能启动随附 FFmpeg");
    let _ = std::fs::remove_file(&output);
    assert!(status.success(), "随附 FFmpeg 必须接受 -fps_mode vfr");
}

#[test]
fn bundled_ffmpeg_encodes_a_decodable_h264_preview_file() {
    let ffmpeg = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("ffmpeg.exe");
    let directory = std::env::temp_dir().join(format!(
        "niuery-openh264-preview-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("系统时间应晚于 Unix 纪元")
            .as_nanos(),
    ));
    std::fs::create_dir_all(&directory).expect("应能创建 H.264 预览测试目录");
    let output = directory.join("preview.mp4");

    let encoded = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=30",
            "-frames:v",
            "30",
            "-c:v",
            "libopenh264",
            "-b:v",
            "8M",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-fps_mode",
            "vfr",
        ])
        .arg(&output)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("应能启动随附 FFmpeg 编码 H.264 预览样本");
    assert!(encoded.success(), "随附 FFmpeg 必须能生成 H.264 预览文件");

    let probe = Command::new(&ffmpeg)
        .args(["-hide_banner", "-i"])
        .arg(&output)
        .args(["-f", "null", "-"])
        .output()
        .expect("应能启动随附 FFmpeg 解码 H.264 预览样本");
    let details = String::from_utf8_lossy(&probe.stderr);
    let _ = std::fs::remove_dir_all(&directory);

    assert!(probe.status.success(), "生成的 H.264 预览文件必须可被解码");
    assert!(
        details.contains("Duration: 00:00:01.00"),
        "预览文件必须具有非零时长"
    );
    assert!(
        details.contains("Video: h264") && details.contains("avc1"),
        "预览文件必须是浏览器可解码的 H.264/avc1 MP4"
    );
}

#[test]
fn concatenating_active_segments_removes_the_pause_from_media_timeline() {
    let ffmpeg = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("ffmpeg.exe");
    let directory =
        std::env::temp_dir().join(format!("niuery-recording-segments-{}", std::process::id()));
    std::fs::create_dir_all(&directory).expect("应能创建临时目录");
    let first = directory.join("active-1.mp4");
    let second = directory.join("active-2.mp4");
    let output = directory.join("recording.mp4");
    for path in [&first, &second] {
        let status = Command::new(&ffmpeg)
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=size=16x16:rate=1",
                "-frames:v",
                "1",
                "-c:v",
                "mpeg4",
            ])
            .arg(path)
            .status()
            .expect("应能生成活动录制片段");
        assert!(status.success());
    }
    concat_recording_segments(&ffmpeg, &[first, second], &output).expect("应能无间隙拼接活动片段");
    let probe = Command::new(&ffmpeg)
        .args(["-hide_banner", "-i"])
        .arg(&output)
        .output()
        .expect("应能读取拼接后的视频");
    let details = String::from_utf8_lossy(&probe.stderr);
    let _ = std::fs::remove_dir_all(&directory);
    assert!(
        details.contains("Duration: 00:00:02"),
        "拼接媒体时间轴只能包含两个活动片段"
    );
}

#[test]
fn discards_frame_when_pause_or_stop_arrives_during_capture() {
    let mut scheduler = RecordingFrameScheduler::new();
    for _ in 0..30 {
        assert!(scheduler.should_write_captured_frame(false, false));
        scheduler.record_written_frame();
    }
    // 模拟 capture_target 返回前暂停请求到达：写入前的二次检查必须丢弃该帧。
    assert!(!scheduler.should_write_captured_frame(false, true));
    assert_eq!(scheduler.written_frames(), 30);

    let frames_before_stop = scheduler.written_frames();
    assert!(!scheduler.should_write_captured_frame(true, false));
    assert_eq!(scheduler.written_frames(), frames_before_stop);
    assert_eq!(scheduler.actual_fps(10_000), 3);
}

#[test]
fn checks_the_tauri_resource_root_for_ffmpeg_before_legacy_nested_paths() {
    let candidates = ffmpeg_resource_candidates(Path::new("bundle-resources"));

    assert_eq!(
        candidates[0],
        Path::new("bundle-resources").join("ffmpeg.exe")
    );
    assert_eq!(
        candidates[1],
        Path::new("bundle-resources")
            .join("resources")
            .join("ffmpeg.exe")
    );
}
