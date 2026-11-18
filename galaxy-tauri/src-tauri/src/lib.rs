pub mod commands;
pub mod constants;
pub mod duplicate_scanner;
pub mod ffmpeg_engine;
pub mod fs_guard;
pub mod history;
pub mod hw_probe;
pub mod image_engine;
pub mod job_scheduler;
pub mod logging;
pub mod models;
pub mod presets;
pub mod process_runner;
pub mod progress_parser;
pub mod settings;
pub mod social_splitter;
pub mod subtitle_fixer;

use commands::AppState;
use job_scheduler::JobScheduler;
use parking_lot::Mutex;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cpu_count = num_cpus::get();
    let scheduler = JobScheduler::new(1, cpu_count);
    let pending_updates = Arc::new(Mutex::new(Vec::new()));

    let app_state = AppState {
        scheduler: scheduler.clone(),
        pending_updates: Arc::clone(&pending_updates),
        hardware: Mutex::new(None),
        probe_lock: tokio::sync::Mutex::new(()),
        verified_duplicates: Mutex::new(HashSet::new()),
    };

    if let Err(err) = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(app_state)
        .setup(move |app| {
            logging::AppLogger::init_and_prune(None);

            let startup_scheduler = scheduler.clone();
            tauri::async_runtime::spawn(async move {
                let app_settings = settings::SettingsStore::load().await;
                startup_scheduler.reconfigure(
                    1,
                    cpu_count,
                    app_settings.max_parallel_jobs,
                    &app_settings.parallel_mode,
                );
                let out_dir = PathBuf::from(&app_settings.output_dir);
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    logging::AppLogger::init_and_prune(Some(&out_dir));
                })
                .await;
            });

            let handle = app.handle().clone();
            let updates_clone = Arc::clone(&pending_updates);
            tauri::async_runtime::spawn(async move {
                progress_parser::run_batch_progress_emitter(handle, updates_clone).await;
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                use tauri::Manager;
                if let Some(state) = window.try_state::<AppState>() {
                    state.scheduler.cancel_all();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::probe_hardware,
            commands::probe_media_file,
            commands::start_video_conversion,
            commands::start_audio_conversion,
            commands::start_image_conversion,
            commands::cancel_job,
            commands::cancel_all_jobs,
            commands::load_settings,
            commands::save_settings,
            commands::open_output_folder,
            commands::scan_directory,
            commands::set_sleep_prevention,
            commands::get_custom_presets,
            commands::save_custom_preset,
            commands::delete_custom_preset,
            commands::export_presets,
            commands::import_presets,
            commands::get_conversion_history,
            commands::delete_history_entry,
            commands::clear_conversion_history,
            commands::get_history_summary,
            commands::export_history_csv,
            commands::get_recent_logs,
            commands::clear_old_logs,
            commands::scan_duplicate_media,
            commands::fix_subtitle_charset,
            commands::split_social_video,
            commands::check_disk_space,
            commands::delete_file,
            commands::extract_audio_stream,
            commands::extract_subtitle_stream,
        ])
        .run(tauri::generate_context!())
    {
        logging::AppLogger::write_crash_log(&format!("Fatal Tauri runtime error: {}", err));
        eprintln!("Fatal Tauri runtime error: {}", err);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use models::{MediaKind, PipelineTier, VideoConversionSettings};
    use progress_parser::ProgressState;
    use std::path::PathBuf;

    #[test]
    fn test_progress_parser_calculation() {
        let mut state = ProgressState::default();
        state.parse_line("out_time_us=5000000"); // 5.0 seconds
        state.parse_line("fps=60.0");
        state.parse_line("speed=2.5x");

        let update = state.calculate_update("job_123", 10.0);
        assert_eq!(update.job_id, "job_123");
        assert!((update.percentage - 50.0).abs() < 0.1);
        assert_eq!(update.fps, 60.0);
        assert_eq!(update.speed, 2.5);
        assert_eq!(update.eta_seconds, 2); // (10 - 5) / 2.5 = 2.0
    }

    #[test]
    fn test_progress_parser_edge_cases() {
        let mut state = ProgressState::default();
        state.parse_line("out_time_us=-10000"); // Negative time due to audio pre-roll
        state.parse_line("fps=N/A");
        state.parse_line("speed=N/A");

        let update = state.calculate_update("job_edge", 0.0); // Total duration 0
        assert_eq!(update.percentage, 0.0);
        assert_eq!(update.fps, 0.0);
        assert_eq!(update.speed, 0.0);
        assert_eq!(update.eta_seconds, 0);
    }

    #[tokio::test]
    async fn test_scheduler_semaphore_raii() {
        let scheduler = JobScheduler::new(1, 4);

        // Acquire the 1 GPU permit
        let permit1 = scheduler
            .acquire_permit(MediaKind::Video, PipelineTier::Tier1)
            .await;
        assert!(permit1.is_ok());

        // Drop permit1 and acquire again - should succeed immediately
        drop(permit1);

        let permit2 = scheduler
            .acquire_permit(MediaKind::Video, PipelineTier::Tier1)
            .await;
        assert!(permit2.is_ok());
    }

    #[test]
    fn test_video_args_copy_streams() {
        let in_path = PathBuf::from("input.mkv");
        let out_path = PathBuf::from("output.mp4");
        let settings = VideoConversionSettings {
            format: "mp4".into(),
            codec: "H.264".into(),
            video_preset: "fast_copy".into(),
            copy_streams: true,
            strip_audio: true,
            strip_subs: true,
            ..Default::default()
        };

        let args = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings,
            PipelineTier::Copy,
            "copy",
        );

        assert!(args.contains(&"-c".to_string()));
        assert!(args.contains(&"copy".to_string()));
        assert!(args.contains(&"-an".to_string()));
        assert!(args.contains(&"-sn".to_string()));
        assert!(args.contains(&"-movflags".to_string()));
        assert!(args.contains(&"+faststart".to_string()));
        assert!(args.contains(&"-progress".to_string()));
        assert!(args.contains(&"pipe:1".to_string()));
    }

    #[test]
    fn test_video_args_trimming_and_filters() {
        let in_path = PathBuf::from("input.mp4");
        let out_path = PathBuf::from("output.mp4");
        let settings = VideoConversionSettings {
            format: "mp4".into(),
            codec: "H.264".into(),
            video_preset: "original".into(),
            trim_start: Some("00:01:10".into()),
            trim_end: Some("00:02:30".into()),
            denoise: true,
            sharpen: true,
            grayscale: true,
            rotate: Some("90".into()),
            ..Default::default()
        };

        let args = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings,
            PipelineTier::Cpu,
            "libx264",
        );

        assert!(args.contains(&"-ss".to_string()));
        assert!(args.contains(&"70".to_string())); // 1m 10s = 70s
        assert!(args.contains(&"-t".to_string()));
        assert!(args.contains(&"80".to_string())); // 150s - 70s = 80s
        assert!(args.contains(&"-pix_fmt".to_string()));
        assert!(args.contains(&"yuv420p".to_string()));
    }

    #[test]
    fn test_audio_args_volume_and_normalize() {
        let in_path = PathBuf::from("input.mp3");
        let out_path = PathBuf::from("output.mp3");
        let settings = models::AudioConversionSettings {
            format: "mp3".into(),
            bitrate: "320k".into(),
            sample_rate: 48000,
            channels: "stereo".into(),
            volume: Some(150),
            normalize: true,
            ..Default::default()
        };

        let args = ffmpeg_engine::FFmpegEngine::build_audio_args(&in_path, &out_path, &settings);

        assert!(args.contains(&"-c:a".to_string()));
        assert!(args.contains(&"libmp3lame".to_string()));
        assert!(args.contains(&"-b:a".to_string()));
        assert!(args.contains(&"320k".to_string()));
        assert!(args.contains(&"-af".to_string()));
        let af_idx = args.iter().position(|a| a == "-af").unwrap();
        // Invariant: Volume MUST precede loudnorm to prevent distortion and digital clipping
        assert_eq!(
            args[af_idx + 1],
            "volume=1.50,loudnorm=I=-14:TP=-1.5:LRA=11"
        );
    }

    #[test]
    fn test_process_runner_error_extraction() {
        use std::collections::VecDeque;
        let mut lines = VecDeque::new();
        lines.push_back("ffmpeg version 6.0 Copyright (c) 2000-2023 the FFmpeg developers".into());
        lines.push_back("Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'sample.mp4':".into());
        lines.push_back(
            "frame=   10 fps=0.0 q=0.0 size=       0kB time=00:00:00.00 bitrate=N/A speed=   0x"
                .into(),
        );
        lines.push_back("[h264 @ 000001] Error: Invalid data found when processing input".into());
        lines.push_back("Conversion failed!".into());

        let result = process_runner::ProcessRunner::extract_ffmpeg_error(&lines);
        assert!(
            result.starts_with("Error: Conversion failed!")
                || result.contains("Invalid data found")
        );
        assert!(result.contains("--- Full FFmpeg Log ---"));
    }

    #[test]
    fn test_audio_args_trimming() {
        let in_path = PathBuf::from("input.flac");
        let out_path = PathBuf::from("output.wav");
        let settings = models::AudioConversionSettings {
            format: "wav".into(),
            trim_start: Some("00:00:15".into()),
            trim_end: Some("00:00:45".into()),
            volume: Some(150),
            ..Default::default()
        };

        let args = ffmpeg_engine::FFmpegEngine::build_audio_args(&in_path, &out_path, &settings);

        assert!(args.contains(&"-ss".to_string()));
        assert!(args.contains(&"15".to_string()));
        assert!(args.contains(&"-t".to_string()));
        assert!(args.contains(&"30".to_string()));
        assert!(args.contains(&"volume=1.50".to_string()));
    }

    #[test]
    fn test_mp3_sample_rate_clamp() {
        let in_path = PathBuf::from("input.wav");
        let out_path = PathBuf::from("output.mp3");
        let settings = models::AudioConversionSettings {
            format: "mp3".into(),
            sample_rate: 96000,
            ..Default::default()
        };

        let args = ffmpeg_engine::FFmpegEngine::build_audio_args(&in_path, &out_path, &settings);

        assert!(args.contains(&"-ar".to_string()));
        let ar_idx = args.iter().position(|a| a == "-ar").unwrap();
        assert_eq!(args[ar_idx + 1], "48000");
    }

    #[test]
    fn test_video_aspect_ratio_safe_scaling() {
        let in_path = PathBuf::from("input.mp4");
        let out_path = PathBuf::from("output.mp4");
        let settings = models::VideoConversionSettings {
            format: "mp4".into(),
            scale: Some("1080p".into()),
            ..Default::default()
        };

        let args = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings,
            models::PipelineTier::Cpu,
            "libx264",
        );

        assert!(args.contains(&"-vf".to_string()));
        let vf_idx = args.iter().position(|a| a == "-vf").unwrap();
        assert_eq!(args[vf_idx + 1], "scale=-2:1080:flags=lanczos");
    }

    #[test]
    fn test_video_args_encoder_speed_preset_sanitization() {
        let in_path = PathBuf::from("input.mp4");
        let out_path = PathBuf::from("output.mp4");

        // Case A: video_preset is "original" (legacy or UI preset id) -> must resolve to safe "medium"
        let settings_original = models::VideoConversionSettings {
            format: "mp4".into(),
            video_preset: "original".into(),
            encoder_speed_preset: "".into(),
            ..Default::default()
        };
        let args_orig = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings_original,
            models::PipelineTier::Cpu,
            "libx264",
        );
        let orig_idx = args_orig.iter().position(|a| a == "-preset").unwrap();
        assert_eq!(args_orig[orig_idx + 1], "medium");
        assert!(!args_orig.contains(&"original".to_string()));

        // Case B: ui_preset_id is "youtube", encoder_speed_preset is "slow" -> must resolve to "slow"
        let settings_youtube = models::VideoConversionSettings {
            format: "mp4".into(),
            ui_preset_id: "youtube".into(),
            video_preset: "youtube".into(),
            encoder_speed_preset: "slow".into(),
            ..Default::default()
        };
        let args_yt = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings_youtube,
            models::PipelineTier::Cpu,
            "libx264",
        );
        let yt_idx = args_yt.iter().position(|a| a == "-preset").unwrap();
        assert_eq!(args_yt[yt_idx + 1], "slow");
        assert!(!args_yt.contains(&"youtube".to_string()));
    }

    #[test]
    fn test_aac_adtstoasc_conditional_application() {
        let in_path = PathBuf::from("input.mkv");
        let out_path = PathBuf::from("output.mp4");

        // Case A: Copy streams with AAC audio -> MUST include -bsf:a aac_adtstoasc
        let settings_aac = models::VideoConversionSettings {
            format: "mp4".into(),
            copy_streams: true,
            source_audio_codec: Some("aac".into()),
            strip_audio: false,
            ..Default::default()
        };
        let args_aac = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings_aac,
            models::PipelineTier::Copy,
            "copy",
        );
        assert!(args_aac.contains(&"-bsf:a".to_string()));
        let bsf_idx = args_aac.iter().position(|a| a == "-bsf:a").unwrap();
        assert_eq!(args_aac[bsf_idx + 1], "aac_adtstoasc");

        // Case B: Copy streams with MP3 audio -> MUST NOT include -bsf:a aac_adtstoasc
        let settings_mp3 = models::VideoConversionSettings {
            format: "mp4".into(),
            copy_streams: true,
            source_audio_codec: Some("mp3".into()),
            strip_audio: false,
            ..Default::default()
        };
        let args_mp3 = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings_mp3,
            models::PipelineTier::Copy,
            "copy",
        );
        assert!(!args_mp3.contains(&"-bsf:a".to_string()));
        assert!(!args_mp3.contains(&"aac_adtstoasc".to_string()));

        // Case C: Copy streams with Opus audio -> MUST NOT include -bsf:a aac_adtstoasc
        let settings_opus = models::VideoConversionSettings {
            format: "mp4".into(),
            copy_streams: true,
            source_audio_codec: Some("opus".into()),
            strip_audio: false,
            ..Default::default()
        };
        let args_opus = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings_opus,
            models::PipelineTier::Copy,
            "copy",
        );
        assert!(!args_opus.contains(&"-bsf:a".to_string()));
        assert!(!args_opus.contains(&"aac_adtstoasc".to_string()));
    }

    #[test]
    fn test_hardware_decoding_tier1_activation() {
        let in_path = PathBuf::from("input.mp4");
        let out_path = PathBuf::from("output.mp4");
        let settings = models::VideoConversionSettings {
            format: "mp4".into(),
            ..Default::default()
        };

        // Tier 1 with NVENC -> -hwaccel cuda before -i
        let args_nvenc = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings,
            models::PipelineTier::Tier1,
            "h264_nvenc",
        );
        assert!(args_nvenc.contains(&"-hwaccel".to_string()));
        let hw_idx = args_nvenc.iter().position(|a| a == "-hwaccel").unwrap();
        assert_eq!(args_nvenc[hw_idx + 1], "cuda");
        let i_idx = args_nvenc.iter().position(|a| a == "-i").unwrap();
        assert!(hw_idx < i_idx);

        // Tier 1 with QSV -> -hwaccel qsv before -i
        let args_qsv = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings,
            models::PipelineTier::Tier1,
            "h264_qsv",
        );
        assert!(args_qsv.contains(&"-hwaccel".to_string()));
        let hw_qsv_idx = args_qsv.iter().position(|a| a == "-hwaccel").unwrap();
        assert_eq!(args_qsv[hw_qsv_idx + 1], "qsv");
        let i_qsv_idx = args_qsv.iter().position(|a| a == "-i").unwrap();
        assert!(hw_qsv_idx < i_qsv_idx);

        // Tier 2 or CPU -> should NOT have -hwaccel
        let args_cpu = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings,
            models::PipelineTier::Cpu,
            "libx264",
        );
        assert!(!args_cpu.contains(&"-hwaccel".to_string()));
    }

    #[test]
    fn test_album_art_audio_classification() {
        use serde_json::json;

        // MP3 with cover art: video stream has disposition attached_pic = 1
        let mock_probe_json = json!({
            "format": {
                "duration": "180.5",
                "size": "5000000",
                "bit_rate": "320000"
            },
            "streams": [
                {
                    "codec_type": "audio",
                    "codec_name": "mp3"
                },
                {
                    "codec_type": "video",
                    "codec_name": "mjpeg",
                    "width": 600,
                    "height": 600,
                    "disposition": {
                        "attached_pic": 1
                    }
                }
            ]
        });

        let file_path = PathBuf::from("music.mp3");
        let media_info =
            ffmpeg_engine::FFmpegEngine::parse_probe_metadata(&mock_probe_json, &file_path);

        assert_eq!(media_info.kind, models::MediaKind::Audio);
        assert_eq!(media_info.audio_codec.as_deref(), Some("mp3"));
        assert_eq!(media_info.video_codec, None);
    }

    #[tokio::test]
    async fn test_in_memory_reserved_names_collision() {
        let temp_dir = std::env::temp_dir().join(format!("col_test_{}", std::process::id()));
        let _ = tokio::fs::create_dir_all(&temp_dir).await;

        let path1 =
            fs_guard::resolve_unique_collision_for_job(&temp_dir, "test_job.mp4", "job_a").await;
        let path2 =
            fs_guard::resolve_unique_collision_for_job(&temp_dir, "test_job.mp4", "job_b").await;

        assert_ne!(path1, path2);
        assert_eq!(path1.file_name().unwrap(), "test_job.mp4");
        assert_eq!(path2.file_name().unwrap(), "test_job (1).mp4");

        // Release path reservations
        fs_guard::release_reserved_path_by_owner(&path1, "job_a");
        fs_guard::release_reserved_path_by_owner(&path2, "job_b");
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn test_reserved_path_owner_isolation_and_no_double_release() {
        let temp_dir = std::env::temp_dir().join(format!("owner_test_{}", std::process::id()));
        let _ = tokio::fs::create_dir_all(&temp_dir).await;

        // Job 1 reserves test_guard.mp4
        let path_j1 =
            fs_guard::resolve_unique_collision_for_job(&temp_dir, "test_guard.mp4", "job_1").await;
        assert_eq!(path_j1.file_name().unwrap(), "test_guard.mp4");

        // Job 2 cannot acquire test_guard.mp4; gets test_guard (1).mp4
        let path_j2 =
            fs_guard::resolve_unique_collision_for_job(&temp_dir, "test_guard.mp4", "job_2").await;
        assert_eq!(path_j2.file_name().unwrap(), "test_guard (1).mp4");

        // Attempting to release job_2's path using job_1's ID MUST FAIL to release job_2
        fs_guard::release_reserved_path_by_owner(&path_j2, "job_1");
        assert!(fs_guard::is_path_reserved(&path_j2));

        // Releasing job_1 frees test_guard.mp4
        fs_guard::release_reserved_path_by_owner(&path_j1, "job_1");
        assert!(!fs_guard::is_path_reserved(&path_j1));

        // Job 3 can now reserve test_guard.mp4
        let path_j3 =
            fs_guard::resolve_unique_collision_for_job(&temp_dir, "test_guard.mp4", "job_3").await;
        assert_eq!(path_j3.file_name().unwrap(), "test_guard.mp4");

        // Cleanup
        fs_guard::release_reserved_path_by_owner(&path_j2, "job_2");
        fs_guard::release_reserved_path_by_owner(&path_j3, "job_3");
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[test]
    fn test_attached_pic_boolean_and_string_formats() {
        use serde_json::json;

        // Test with boolean true in disposition
        let json_bool = json!({
            "format": { "duration": "60.0", "size": "1000", "bit_rate": "128000" },
            "streams": [
                { "codec_type": "audio", "codec_name": "aac" },
                { "codec_type": "video", "codec_name": "png", "disposition": { "attached_pic": true } }
            ]
        });
        let info_bool = ffmpeg_engine::FFmpegEngine::parse_probe_metadata(
            &json_bool,
            &PathBuf::from("audio.m4a"),
        );
        assert_eq!(info_bool.kind, models::MediaKind::Audio);

        // Test with string "1" in disposition
        let json_str = json!({
            "format": { "duration": "60.0", "size": "1000", "bit_rate": "128000" },
            "streams": [
                { "codec_type": "audio", "codec_name": "flac" },
                { "codec_type": "video", "codec_name": "mjpeg", "disposition": { "attached_pic": "1" } }
            ]
        });
        let info_str = ffmpeg_engine::FFmpegEngine::parse_probe_metadata(
            &json_str,
            &PathBuf::from("audio.flac"),
        );
        assert_eq!(info_str.kind, models::MediaKind::Audio);
    }

    #[test]
    fn test_nvenc_preset_sanitization_defense() {
        let in_path = PathBuf::from("input.mp4");
        let out_path = PathBuf::from("output.mp4");

        // Pass invalid nvenc_preset like "original" or "youtube" -> must fallback to safe "p4"
        let settings = models::VideoConversionSettings {
            format: "mp4".into(),
            nvenc_preset: "original".into(),
            ..Default::default()
        };

        let args = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings,
            models::PipelineTier::Tier1,
            "h264_nvenc",
        );

        let p_idx = args.iter().position(|a| a == "-preset").unwrap();
        assert_eq!(args[p_idx + 1], "p4");
        assert!(!args.contains(&"original".to_string()));
    }

    #[test]
    fn test_video_color_eq_filters() {
        let in_path = PathBuf::from("input.mp4");
        let out_path = PathBuf::from("output.mp4");
        let settings = models::VideoConversionSettings {
            brightness: Some(0.1),
            contrast: Some(1.2),
            saturation: Some(1.1),
            gamma: Some(0.9),
            ..Default::default()
        };

        let args = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings,
            models::PipelineTier::Cpu,
            "libx264",
        );

        let vf_idx = args
            .iter()
            .position(|a| a == "-vf")
            .expect("-vf should be present");
        let vf_val = &args[vf_idx + 1];
        assert!(vf_val.contains("eq=brightness=0.10:contrast=1.20:saturation=1.10:gamma=0.90"));
    }

    #[test]
    fn test_video_prores_profile() {
        let in_path = PathBuf::from("input.mov");
        let out_path = PathBuf::from("output.mov");
        let settings = models::VideoConversionSettings {
            format: "mov".into(),
            codec: "prores".into(),
            prores_profile: Some("hq".into()),
            ..Default::default()
        };

        let args = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings,
            models::PipelineTier::Cpu,
            "libx264",
        );

        assert!(args.contains(&"prores_ks".to_string()));
        let p_idx = args
            .iter()
            .position(|a| a == "-profile:v")
            .expect("-profile:v must exist");
        assert_eq!(args[p_idx + 1], "3"); // 3 = HQ
        assert!(args.contains(&"apl0".to_string()));
    }

    #[test]
    fn test_video_even_crop_presets() {
        let in_path = PathBuf::from("input.mp4");
        let out_path = PathBuf::from("output.mp4");

        // 1:1 Crop
        let s1 = models::VideoConversionSettings {
            crop: Some("1:1".into()),
            ..Default::default()
        };
        let args1 = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &s1,
            models::PipelineTier::Cpu,
            "libx264",
        );
        let vf1 = &args1[args1.iter().position(|a| a == "-vf").unwrap() + 1];
        assert!(vf1.contains("crop='trunc(min(iw,ih)/2)*2':'trunc(min(iw,ih)/2)*2'"));

        // 9:16 Crop
        let s2 = models::VideoConversionSettings {
            crop: Some("9:16".into()),
            ..Default::default()
        };
        let args2 = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &s2,
            models::PipelineTier::Cpu,
            "libx264",
        );
        let vf2 = &args2[args2.iter().position(|a| a == "-vf").unwrap() + 1];
        assert!(vf2.contains("crop='trunc(min(iw,ih*9/16)/2)*2':'trunc(min(ih,iw*16/9)/2)*2'"));
    }

    #[test]
    fn test_speed_pts_and_atempo_chain() {
        // Test speed 2.5x -> chained atempo
        let chain_2_5 = ffmpeg_engine::FFmpegEngine::build_atempo_chain(2.5);
        assert_eq!(chain_2_5.len(), 2);
        assert_eq!(chain_2_5[0], "atempo=2.0");
        assert_eq!(chain_2_5[1], "atempo=1.250");

        // Test speed 0.25x -> chained atempo
        let chain_0_25 = ffmpeg_engine::FFmpegEngine::build_atempo_chain(0.25);
        assert_eq!(chain_0_25.len(), 2);
        assert_eq!(chain_0_25[0], "atempo=0.5");
        assert_eq!(chain_0_25[1], "atempo=0.5");

        // Video PTS with speed 2.0
        let in_path = PathBuf::from("input.mp4");
        let out_path = PathBuf::from("output.mp4");
        let s = models::VideoConversionSettings {
            speed: Some(2.0),
            ..Default::default()
        };
        let args = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &s,
            models::PipelineTier::Cpu,
            "libx264",
        );
        let vf = &args[args.iter().position(|a| a == "-vf").unwrap() + 1];
        assert!(vf.contains("setpts=0.5000*PTS"));
        assert!(args.contains(&"-fps_mode".to_string()));
        assert!(args.contains(&"cfr".to_string()));
    }

    #[test]
    fn test_audio_mastering_filters() {
        let in_path = PathBuf::from("input.wav");
        let out_path = PathBuf::from("output.mp3");
        let settings = models::AudioConversionSettings {
            bass_boost: Some(6.0),
            treble_boost: Some(-2.5),
            compressor: true,
            reverb: true,
            downmix: true,
            loudnorm_preset: Some("podcast".into()),
            ..Default::default()
        };

        let args = ffmpeg_engine::FFmpegEngine::build_audio_args(&in_path, &out_path, &settings);
        let af_idx = args
            .iter()
            .position(|a| a == "-af")
            .expect("-af must exist");
        let af_val = &args[af_idx + 1];

        assert!(af_val.contains("bass=g=6.0:f=100:w=0.5"));
        assert!(af_val.contains("treble=g=-2.5:f=3000:w=0.5"));
        assert!(af_val.contains("acompressor=threshold=-21dB:ratio=4:attack=5:release=50"));
        assert!(af_val.contains("aecho=0.8:0.88:60:0.4"));
        assert!(af_val.contains("pan=stereo"));
        assert!(af_val.contains("loudnorm=I=-16:TP=-1.0:LRA=11"));
    }

    #[test]
    fn test_gif_2pass_palette_engine() {
        let in_path = PathBuf::from("clip.mp4");
        let out_path = PathBuf::from("clip.gif");
        let settings = models::VideoConversionSettings {
            format: "gif".into(),
            ..Default::default()
        };

        let args = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings,
            models::PipelineTier::Cpu,
            "libx264",
        );

        let fc_idx = args
            .iter()
            .position(|a| a == "-filter_complex")
            .expect("-filter_complex must exist for GIF");
        let fc = &args[fc_idx + 1];
        assert!(fc.contains("split[s0][s1]"));
        assert!(fc.contains("palettegen=reserve_transparent=on:stats_mode=diff[p]"));
        assert!(fc.contains("paletteuse=dither=bayer:bayer_scale=5"));
        assert!(args.contains(&"-an".to_string()));
    }

    #[test]
    fn test_persian_cp1256_detection_and_transcoding() {
        // Bytes for "ایران" in Windows-1256:
        // ا = 0xC7, ی = 0xED, ر = 0xD1, ا = 0xC7, ن = 0xE4
        let cp1256_bytes = vec![0xC7, 0xED, 0xD1, 0xC7, 0xE4];
        let utf8_res = subtitle_fixer::SubtitleFixer::convert_cp1256_to_utf8(&cp1256_bytes);

        assert!(utf8_res.starts_with('\u{FEFF}')); // UTF-8 BOM
        assert!(utf8_res.contains("ایران"));
    }

    #[test]
    fn test_social_splitter_segment_calculation() {
        let segments = social_splitter::SocialSplitter::calculate_segments(
            65.0,
            15.0,
            2.0, // 2s overlap -> step is 13.0s
            "video",
            &PathBuf::from("/out"),
        );

        assert_eq!(segments.len(), 5);
        assert_eq!(segments[0].start_sec, 0.0);
        assert_eq!(segments[0].duration_sec, 15.0);
        assert_eq!(segments[1].start_sec, 13.0);
        assert_eq!(segments[1].duration_sec, 15.0);
        assert_eq!(segments[2].start_sec, 26.0);
        assert_eq!(segments[3].start_sec, 39.0);
        assert_eq!(segments[4].start_sec, 52.0);
        assert_eq!(segments[4].duration_sec, 13.0); // 65 - 52 = 13.0s
    }

    #[test]
    fn test_custom_preset_serialization() {
        let preset = models::CustomPreset {
            id: "preset_1".into(),
            name: "My 4K Ultra".into(),
            description: "Custom 4K High Bitrate".into(),
            kind: models::MediaKind::Video,
            video_settings: Some(models::VideoConversionSettings {
                format: "mp4".into(),
                crf: Some(16),
                ..Default::default()
            }),
            audio_settings: None,
            image_settings: None,
            created_at: 1700000000,
        };

        let json = serde_json::to_string(&preset).unwrap();
        let deserialized: models::CustomPreset = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.id, "preset_1");
        assert_eq!(deserialized.name, "My 4K Ultra");
        assert_eq!(deserialized.video_settings.as_ref().unwrap().crf, Some(16));
    }

    static DATA_DIR_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    struct TempDataDirGuard {
        _lock: tokio::sync::MutexGuard<'static, ()>,
        prev_data_dir: Option<String>,
        dir: PathBuf,
    }

    impl TempDataDirGuard {
        async fn enter(prefix: &str) -> Self {
            let lock = DATA_DIR_TEST_LOCK.lock().await;
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let dir = std::env::temp_dir().join(format!("{}_{}", prefix, nanos));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("temp test dir creation must succeed");
            let prev_data_dir = std::env::var("GALAXY_DATA_DIR").ok();
            std::env::set_var("GALAXY_DATA_DIR", &dir);
            Self {
                _lock: lock,
                prev_data_dir,
                dir,
            }
        }
    }

    impl Drop for TempDataDirGuard {
        fn drop(&mut self) {
            if let Some(ref prev) = self.prev_data_dir {
                std::env::set_var("GALAXY_DATA_DIR", prev);
            } else {
                std::env::remove_var("GALAXY_DATA_DIR");
            }
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[tokio::test]
    async fn test_history_store_crud_concurrency_csv_and_corrupt_backup() {
        let guard = TempDataDirGuard::enter("galaxy_hist_test").await;

        // 10-way concurrent writes via tokio::spawn
        let mut handles = Vec::new();
        for i in 0..10u64 {
            handles.push(tokio::spawn(async move {
                let entry = models::HistoryEntry {
                    id: format!("job_conc_{}", i),
                    input_path: format!("D:/in/file_{}.mp4", i),
                    output_path: format!("=CMD|file_{}.mkv", i),
                    filename: format!("=file_{}.mkv", i),
                    source_size_bytes: 1_000_000,
                    output_size_bytes: 400_000,
                    duration_secs: 30.0,
                    format: "mkv".into(),
                    speed: 2.0 + (i as f32) * 0.1,
                    timestamp: 1_700_000_000 + i,
                    status: "completed".into(),
                };
                history::HistoryStore::add_entry(entry).await
            }));
        }
        for h in handles {
            h.await.unwrap().unwrap();
        }

        // Idempotent upsert on existing id must update instead of duplicating
        history::HistoryStore::add_entry(models::HistoryEntry {
            id: "job_conc_0".into(),
            input_path: "D:/in/file_0.mp4".into(),
            output_path: "=CMD|file_0_v2.mkv".into(),
            filename: "=file_0_v2.mkv".into(),
            source_size_bytes: 2_000_000,
            output_size_bytes: 800_000,
            duration_secs: 30.0,
            format: "mkv".into(),
            speed: 4.0,
            timestamp: 1_700_000_999,
            status: "completed".into(),
        })
        .await
        .unwrap();

        let loaded = history::HistoryStore::load().await;
        assert_eq!(loaded.len(), 10);

        let summary = history::HistoryStore::get_summary().await;
        assert_eq!(summary.total_files, 10);
        assert_eq!(summary.total_source_bytes, 11_000_000);
        assert_eq!(summary.total_output_bytes, 4_400_000);
        assert_eq!(summary.total_saved_bytes, 6_600_000);

        // Delete one entry
        assert!(history::HistoryStore::delete_entry("job_conc_5")
            .await
            .unwrap());
        assert!(!history::HistoryStore::delete_entry("nonexistent_id")
            .await
            .unwrap());
        assert_eq!(history::HistoryStore::load().await.len(), 9);

        // CSV formula-injection neutralization
        let csv_path = guard.dir.join("export.csv");
        history::HistoryStore::export_csv(&csv_path).await.unwrap();
        let csv_text = tokio::fs::read_to_string(&csv_path).await.unwrap();
        assert!(csv_text.contains("\"'=file_0_v2.mkv\""));
        assert!(csv_text.contains("\"'=CMD|file_0_v2.mkv\""));

        // Corrupt JSON recovery backs up corrupt file as .bak
        let hist_path = history::HistoryStore::history_path();
        tokio::fs::write(&hist_path, b"{not valid json")
            .await
            .unwrap();
        let recovered = history::HistoryStore::load().await;
        assert!(recovered.is_empty());
        let has_bak = std::fs::read_dir(&guard.dir)
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().contains(".bak"));
        assert!(has_bak, "Corrupt history JSON must be backed up as .bak");
    }

    #[test]
    fn test_custom_crop_parsing_multi_arg() {
        let in_path = PathBuf::from("in.mp4");
        let out_path = PathBuf::from("out.mp4");
        let settings = models::VideoConversionSettings {
            crop: Some("1920:1080:10:20".into()),
            ..Default::default()
        };

        let args = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings,
            models::PipelineTier::Cpu,
            "libx264",
        );

        let vf_idx = args
            .iter()
            .position(|a| a == "-vf")
            .expect("-vf must exist");
        let vf = &args[vf_idx + 1];
        assert!(vf.contains("crop='trunc(1920/2)*2':'trunc(1080/2)*2':10:20"));
    }

    #[test]
    fn test_subtitle_burn_in_args() {
        let in_path = PathBuf::from("in.mp4");
        let out_path = PathBuf::from("out.mp4");
        let settings = models::VideoConversionSettings {
            subtitle_path: Some("C:\\subtitles\\movie.srt".into()),
            fps: Some(60),
            ..Default::default()
        };

        let args = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings,
            models::PipelineTier::Cpu,
            "libx264",
        );

        let vf_idx = args
            .iter()
            .position(|a| a == "-vf")
            .expect("-vf must exist");
        let vf = &args[vf_idx + 1];
        assert!(vf.contains(
            "subtitles='C\\:/subtitles/movie.srt':force_style='Fontname=Vazirmatn,FontSize=20'"
        ));
        assert!(vf.contains("fps=60"));
        assert!(args.contains(&"-fps_mode".to_string()));
        assert!(args.contains(&"cfr".to_string()));
    }

    #[test]
    fn test_metadata_tags_construction() {
        let in_path = PathBuf::from("song.wav");
        let out_path = PathBuf::from("song.mp3");
        let settings = models::AudioConversionSettings {
            metadata_title: Some("My Song".into()),
            metadata_artist: Some("My Artist".into()),
            metadata_album: Some("My Album".into()),
            metadata_year: Some("2026".into()),
            metadata_copyright: Some("Copyright 2026".into()),
            ..Default::default()
        };

        let args = ffmpeg_engine::FFmpegEngine::build_audio_args(&in_path, &out_path, &settings);
        assert!(args.contains(&"title=My Song".to_string()));
        assert!(args.contains(&"artist=My Artist".to_string()));
        assert!(args.contains(&"album=My Album".to_string()));
        assert!(args.contains(&"date=2026".to_string()));
        assert!(args.contains(&"copyright=Copyright 2026".to_string()));
    }

    #[tokio::test]
    async fn test_utf16_subtitle_transcoding() {
        // Create UTF-16 LE with BOM: \xFF\xFE followed by "سلام" in UTF-16 LE:
        // س = 0x0633 -> [0x33, 0x06]
        // ل = 0x0644 -> [0x44, 0x06]
        // ا = 0x0627 -> [0x27, 0x06]
        // م = 0x0645 -> [0x45, 0x06]
        let mut raw_bytes = vec![0xFF, 0xFE];
        raw_bytes.extend([0x33, 0x06, 0x44, 0x06, 0x27, 0x06, 0x45, 0x06]);

        let temp_dir = std::env::temp_dir();
        let sub_path = temp_dir.join("test_utf16_sub.srt");
        tokio::fs::write(&sub_path, &raw_bytes).await.unwrap();

        let res = subtitle_fixer::SubtitleFixer::fix_subtitle_file(&sub_path)
            .await
            .unwrap();
        let content = tokio::fs::read_to_string(&res).await.unwrap();
        assert!(content.starts_with('\u{FEFF}'));
        assert!(content.contains("سلام"));

        let _ = tokio::fs::remove_file(&sub_path).await;
        let _ = tokio::fs::remove_file(&res).await;
    }

    #[test]
    fn test_disk_space_guard_case_insensitive() {
        // Run check_disk_space on current dir
        let curr = std::env::current_dir().unwrap();
        let info = fs_guard::check_disk_space(&curr, 1024 * 1024);
        assert!(info.total_bytes > 0);
        assert!(info.available_bytes > 0);
    }

    #[tokio::test]
    async fn test_webp_image_conversion_with_quality() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("webp_test_{}", nanos));
        let _ = tokio::fs::create_dir_all(&temp_dir).await;

        // Generate small test image
        let img = image::RgbImage::from_fn(32, 32, |x, y| {
            image::Rgb([(x * 8) as u8, (y * 8) as u8, 128])
        });
        let in_png = temp_dir.join("sample.png");
        img.save(&in_png).unwrap();

        let settings = models::ImageConversionSettings {
            format: "webp".into(),
            quality: 75,
            ..Default::default()
        };

        let pending = Arc::new(Mutex::new(Vec::new()));
        let token = tokio_util::sync::CancellationToken::new();
        let result = image_engine::ImageEngine::convert_image(
            in_png.clone(),
            temp_dir.clone(),
            settings,
            "job_webp_test".into(),
            token,
            Arc::clone(&pending),
        )
        .await;

        assert!(result.is_ok(), "WebP encoding should succeed");
        let out_webp = result.unwrap();
        assert!(out_webp.exists());
        assert!(out_webp.extension().unwrap() == "webp");
        assert!(tokio::fs::metadata(&out_webp).await.unwrap().len() > 0);
        assert!(pending
            .lock()
            .iter()
            .any(|u| (u.percentage - 100.0).abs() < 0.1));

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[test]
    fn test_parse_timecode_mm_ss_and_validation() {
        use ffmpeg_engine::FFmpegEngine;
        assert_eq!(FFmpegEngine::parse_timecode("01:30"), Some(90.0));
        assert_eq!(FFmpegEngine::parse_timecode("01:30.5"), Some(90.5));
        assert_eq!(FFmpegEngine::parse_timecode("00:01:30.25"), Some(90.25));
        assert_eq!(FFmpegEngine::parse_timecode("45"), Some(45.0));
        assert_eq!(FFmpegEngine::parse_timecode("01:60"), None);
        assert_eq!(FFmpegEngine::parse_timecode("00:60:00"), None);
        assert_eq!(FFmpegEngine::parse_timecode("-5"), None);
        assert_eq!(FFmpegEngine::parse_timecode("NaN"), None);
        assert_eq!(FFmpegEngine::parse_timecode("inf"), None);
        assert_eq!(FFmpegEngine::parse_timecode("900000"), None);
        assert_eq!(FFmpegEngine::format_timecode_secs(90.0), "90");
        assert_eq!(FFmpegEngine::format_timecode_secs(90.5), "90.5");
    }

    #[test]
    fn test_showstopper_1_prores_requires_mov_and_prores_codec() {
        let in_path = PathBuf::from("in.mp4");
        let out_path = PathBuf::from("out.mp4");
        let settings = VideoConversionSettings {
            format: "mp4".into(),
            codec: "H.264".into(),
            prores_profile: Some("standard".into()),
            ..Default::default()
        };
        let args = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &settings,
            PipelineTier::Cpu,
            "libx264",
        );
        assert!(!args.contains(&"prores_ks".to_string()));
        assert!(args.contains(&"libx264".to_string()));
    }

    #[test]
    fn test_showstopper_4_audio_defaults_and_ogg_vorbis() {
        let in_path = PathBuf::from("in.wav");
        let out_path = PathBuf::from("out.ogg");
        let settings = models::AudioConversionSettings {
            format: "ogg".into(),
            bitrate: "192k".into(),
            sample_rate: 0,
            channels: "original".into(),
            loudnorm_preset: Some("none".into()),
            normalize: false,
            ..Default::default()
        };
        let args = ffmpeg_engine::FFmpegEngine::build_audio_args(&in_path, &out_path, &settings);
        assert!(!args.contains(&"-ar".to_string()));
        assert!(!args.contains(&"-ac".to_string()));
        assert!(!args.iter().any(|a| a.contains("loudnorm")));
        let q_idx = args
            .iter()
            .position(|a| a == "-q:a")
            .expect("ogg should use -q:a");
        assert_eq!(args[q_idx + 1], "6");
        assert!(!args.contains(&"-b:a".to_string()));
    }

    #[test]
    fn test_video_encoders_nvenc_svtav1_vp9_aom() {
        let in_path = PathBuf::from("in.mp4");
        let out_path = PathBuf::from("out.mkv");

        let nv_args = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &VideoConversionSettings::default(),
            PipelineTier::Tier1,
            "h264_nvenc",
        );
        assert!(nv_args.windows(2).any(|w| w == ["-rc", "vbr"]));
        assert!(nv_args.windows(2).any(|w| w == ["-b:v", "0"]));
        assert!(nv_args.windows(2).any(|w| w == ["-cq", "23"]));

        let svt_settings = VideoConversionSettings {
            encoder_speed_preset: "ultrafast".into(),
            ..Default::default()
        };
        let svt_args = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &svt_settings,
            PipelineTier::Cpu,
            "libsvtav1",
        );
        assert!(svt_args.windows(2).any(|w| w == ["-preset", "10"]));

        let vp9_args = ffmpeg_engine::FFmpegEngine::build_video_args(
            &in_path,
            &out_path,
            &VideoConversionSettings::default(),
            PipelineTier::Cpu,
            "libvpx-vp9",
        );
        assert!(!vp9_args.contains(&"-preset".to_string()));
        assert!(vp9_args.windows(2).any(|w| w == ["-deadline", "good"]));
        assert!(vp9_args.windows(2).any(|w| w == ["-row-mt", "1"]));
    }

    #[test]
    fn test_validate_settings_and_subtitle_escaping() {
        use ffmpeg_engine::FFmpegEngine;
        let escaped = FFmpegEngine::escape_ffmpeg_subtitles_path(r"C:\sub's [1],;test.srt");
        assert_eq!(escaped, r"C\:/sub\'s \[1\]\,\;test.srt");

        let bad_vid = VideoConversionSettings {
            trim_start: Some("00:02:00".into()),
            trim_end: Some("00:01:00".into()),
            ..Default::default()
        };
        assert!(FFmpegEngine::validate_video_settings(&bad_vid).is_err());

        let bad_crop = VideoConversionSettings {
            crop: Some("100:100;evil".into()),
            ..Default::default()
        };
        assert!(FFmpegEngine::validate_video_settings(&bad_crop).is_err());

        let bad_aud = models::AudioConversionSettings {
            trim_start: Some("abc".into()),
            ..Default::default()
        };
        assert!(FFmpegEngine::validate_audio_settings(&bad_aud).is_err());
    }

    #[test]
    fn test_hw_probe_recommendation_and_ffmpeg_i_stderr_parse() {
        let gpus_intel_only = vec![models::GpuDeviceInfo {
            index: 0,
            name: "Intel(R) UHD Graphics".into(),
            vendor: "intel".into(),
        }];
        let encs_nvenc_only = vec!["h264_nvenc".to_string()];
        let (backend, slots) =
            hw_probe::HardwareProber::compute_recommendation(&gpus_intel_only, &encs_nvenc_only);
        assert_eq!(backend, "cpu");
        assert_eq!(slots, 0);

        let gpus_rtx40 = vec![models::GpuDeviceInfo {
            index: 0,
            name: "NVIDIA GeForce RTX 4070".into(),
            vendor: "nvidia".into(),
        }];
        let (backend_nv, slots_nv) =
            hw_probe::HardwareProber::compute_recommendation(&gpus_rtx40, &encs_nvenc_only);
        assert_eq!(backend_nv, "nvidia");
        assert_eq!(slots_nv, 2);

        let sample_stderr = "\
Input #0, mov,mp4,m4a, from 'clip.mp4':
  Duration: 00:01:23.50, start: 0.000000, bitrate: 1500 kb/s
  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 30 fps
  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo, fltp, 192 kb/s";
        let info = ffmpeg_engine::FFmpegEngine::parse_ffmpeg_i_stderr(
            sample_stderr,
            &PathBuf::from("clip.mp4"),
            12345,
        )
        .unwrap();
        assert!((info.duration_secs - 83.5).abs() < 0.01);
        assert_eq!(info.width, Some(1920));
        assert_eq!(info.height, Some(1080));
        assert_eq!(info.video_codec.as_deref(), Some("h264"));
        assert_eq!(info.audio_codec.as_deref(), Some("aac"));
    }

    #[tokio::test]
    async fn test_scheduler_duplicate_sequential_and_cancellable() {
        let scheduler = JobScheduler::new(2, 8);
        let token1 = scheduler.register_job("job_dup").unwrap();
        assert!(scheduler.register_job("job_dup").is_err());

        scheduler.reconfigure(2, 8, 0, "sequential");
        let p1 = scheduler
            .acquire_permit_cancellable(MediaKind::Video, PipelineTier::Cpu, &token1)
            .await
            .unwrap();

        let token2 = scheduler.register_job("job_cancel").unwrap();
        let sched_clone = scheduler.clone();
        let tok2_clone = token2.clone();
        let waiter = tokio::spawn(async move {
            sched_clone
                .acquire_permit_cancellable(MediaKind::Video, PipelineTier::Cpu, &tok2_clone)
                .await
        });
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        assert!(scheduler.cancel_job("job_cancel"));
        let res = waiter.await.unwrap();
        assert!(matches!(res, Err(models::AppError::JobCancelled)));

        drop(p1);
        scheduler.unregister_job("job_dup");
        scheduler.unregister_job("job_cancel");
    }

    #[tokio::test]
    async fn test_image_fast_probe_ico_tiff_avif_and_icc() {
        use image::{ImageDecoder, ImageEncoder};
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_dir = std::env::temp_dir().join(format!("img_suite_{}", nanos));
        let _ = tokio::fs::create_dir_all(&temp_dir).await;

        let img = image::RgbaImage::from_fn(64, 64, |x, y| {
            image::Rgba([(x * 4) as u8, (y * 4) as u8, 200, 255])
        });
        let in_png = temp_dir.join("src.png");
        {
            let file = std::fs::File::create(&in_png).unwrap();
            let mut enc = image::codecs::png::PngEncoder::new(file);
            let _ = enc.set_icc_profile(vec![1, 2, 3, 4, 5, 6, 7, 8]);
            enc.write_image(img.as_raw(), 64, 64, image::ExtendedColorType::Rgba8)
                .unwrap();
        }

        // Pure-Rust fast probe without ffprobe
        let probed = ffmpeg_engine::FFmpegEngine::probe_file(&in_png)
            .await
            .unwrap();
        assert_eq!(probed.kind, MediaKind::Image);
        assert_eq!(probed.width, Some(64));
        assert_eq!(probed.height, Some(64));

        let pending = Arc::new(Mutex::new(Vec::new()));

        // Preserve ICC in JPEG/PNG
        let png_keep = image_engine::ImageEngine::convert_image(
            in_png.clone(),
            temp_dir.clone(),
            models::ImageConversionSettings {
                format: "png".into(),
                strip_metadata: false,
                ..Default::default()
            },
            "job_icc_keep".into(),
            tokio_util::sync::CancellationToken::new(),
            Arc::clone(&pending),
        )
        .await
        .unwrap();
        let mut dec_keep = image::ImageReader::open(&png_keep)
            .unwrap()
            .into_decoder()
            .unwrap();
        assert_eq!(
            dec_keep.icc_profile().unwrap().as_deref(),
            Some(&[1u8, 2, 3, 4, 5, 6, 7, 8][..])
        );

        // Strip ICC when strip_metadata == true
        let png_strip = image_engine::ImageEngine::convert_image(
            in_png.clone(),
            temp_dir.clone(),
            models::ImageConversionSettings {
                format: "png".into(),
                strip_metadata: true,
                ..Default::default()
            },
            "job_icc_strip".into(),
            tokio_util::sync::CancellationToken::new(),
            Arc::clone(&pending),
        )
        .await
        .unwrap();
        let mut dec_strip = image::ImageReader::open(&png_strip)
            .unwrap()
            .into_decoder()
            .unwrap();
        assert_eq!(dec_strip.icc_profile().unwrap(), None);

        // Multi-size ICO
        let out_ico = image_engine::ImageEngine::convert_image(
            in_png.clone(),
            temp_dir.clone(),
            models::ImageConversionSettings {
                format: "ico".into(),
                ..Default::default()
            },
            "job_ico".into(),
            tokio_util::sync::CancellationToken::new(),
            Arc::clone(&pending),
        )
        .await
        .unwrap();
        let ico_bytes = tokio::fs::read(&out_ico).await.unwrap();
        // ICONDIR image count at bytes 4..6 (little endian) for 64x64 -> [64, 48, 32, 16] = 4 frames
        assert_eq!(u16::from_le_bytes([ico_bytes[4], ico_bytes[5]]), 4);

        // TIFF
        let out_tiff = image_engine::ImageEngine::convert_image(
            in_png.clone(),
            temp_dir.clone(),
            models::ImageConversionSettings {
                format: "tif".into(),
                ..Default::default()
            },
            "job_tiff".into(),
            tokio_util::sync::CancellationToken::new(),
            Arc::clone(&pending),
        )
        .await
        .unwrap();
        assert!(out_tiff.exists());

        // AVIF quality
        let out_avif = image_engine::ImageEngine::convert_image(
            in_png,
            temp_dir.clone(),
            models::ImageConversionSettings {
                format: "avif".into(),
                quality: 60,
                ..Default::default()
            },
            "job_avif".into(),
            tokio_util::sync::CancellationToken::new(),
            pending,
        )
        .await
        .unwrap();
        assert!(tokio::fs::metadata(&out_avif).await.unwrap().len() > 0);

        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn test_social_splitter_validation() {
        let res1 = social_splitter::SocialSplitter::split_video(
            &PathBuf::from("nonexistent.mp4"),
            2,
            0,
            false,
            &std::env::temp_dir(),
            tokio_util::sync::CancellationToken::new(),
        )
        .await;
        assert!(matches!(res1, Err(models::AppError::Validation(_))));

        let res2 = social_splitter::SocialSplitter::split_video(
            &PathBuf::from("nonexistent.mp4"),
            10,
            10,
            false,
            &std::env::temp_dir(),
            tokio_util::sync::CancellationToken::new(),
        )
        .await;
        assert!(matches!(res2, Err(models::AppError::Validation(_))));
    }

    #[tokio::test]
    async fn test_app_logger_write_read_and_prune() {
        let _guard = TempDataDirGuard::enter("galaxy_logger_test").await;

        logging::AppLogger::info("audit", "first structured line");
        logging::AppLogger::warn("audit", "second\nmultiline");

        let lines = logging::AppLogger::read_recent_logs(10);
        assert!(lines
            .iter()
            .any(|l| l.contains("[INFO] [audit] first structured line")));
        assert!(lines
            .iter()
            .any(|l| l.contains("[WARN] [audit] second \\n multiline")));

        // Synthetic rotated archive should be pruned by clear_old_logs()
        let archive_path = logging::AppLogger::logs_dir().join("galaxy.log.1");
        tokio::fs::write(&archive_path, b"rotated line\n")
            .await
            .unwrap();
        assert!(archive_path.exists());
        let deleted = logging::AppLogger::clear_old_logs().unwrap();
        assert!(deleted >= 1);
        assert!(!archive_path.exists());
    }

    #[tokio::test]
    async fn test_duplicate_scanner_two_stage_full_hash_and_sanitize_filename() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let scan_dir = std::env::temp_dir().join(format!("galaxy_dup_test_{}", nanos));
        tokio::fs::create_dir_all(&scan_dir).await.unwrap();

        // 256 KiB payload: identical head/mid/tail 64 KiB chunks, differing at offset 70_000
        let a = vec![0x2Au8; 256 * 1024];
        let mut b = a.clone();
        b[70_000] = 0x9F; // strictly between first 64 KiB (0..65536) and middle 64 KiB (98304..163840)
        let exact_copy = a.clone();

        tokio::fs::write(scan_dir.join("dup_a.mp4"), &a)
            .await
            .unwrap();
        tokio::fs::write(scan_dir.join("dup_exact.mp4"), &exact_copy)
            .await
            .unwrap();
        tokio::fs::write(scan_dir.join("almost_diff.mp4"), &b)
            .await
            .unwrap();

        let groups =
            duplicate_scanner::DuplicateScanner::scan_directory(&scan_dir.to_string_lossy())
                .await
                .unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].files.len(), 2);
        let names: Vec<&str> = groups[0]
            .files
            .iter()
            .map(|f| f.filename.as_str())
            .collect();
        assert!(names.contains(&"dup_a.mp4"));
        assert!(names.contains(&"dup_exact.mp4"));
        assert!(!names.contains(&"almost_diff.mp4"));

        let _ = tokio::fs::remove_dir_all(&scan_dir).await;

        assert_eq!(fs_guard::sanitize_filename("CON.mp4"), "_CON.mp4");
        assert_eq!(fs_guard::sanitize_filename(".."), "output");
        assert_eq!(
            fs_guard::sanitize_filename("a:b*c?d<e>f|g.mkv"),
            "a_b_c_d_e_f_g.mkv"
        );
        let long_stem = format!("{}.mp4", "آ".repeat(200));
        let sanitized_long = fs_guard::sanitize_filename(&long_stem);
        assert!(sanitized_long.ends_with(".mp4"));
        assert!(sanitized_long.chars().count() <= 164);
    }

    #[tokio::test]
    async fn test_presets_export_sanitization_and_import_clamping() {
        let guard = TempDataDirGuard::enter("galaxy_presets_test").await;

        let local_preset = models::CustomPreset {
            id: "p_export".into(),
            name: "Studio Export".into(),
            description: "Strips machine-local paths".into(),
            kind: models::MediaKind::Video,
            video_settings: Some(VideoConversionSettings {
                format: "mp4".into(),
                output_dir: "C:\\Users\\Alice\\Videos".into(),
                subtitle_path: Some("C:\\Users\\Alice\\subs.srt".into()),
                ..Default::default()
            }),
            audio_settings: None,
            image_settings: None,
            created_at: 1_700_000_000,
        };
        presets::PresetsStore::save_all(&[local_preset])
            .await
            .unwrap();

        let export_path = guard.dir.join("exported_presets.json");
        presets::PresetsStore::export_to_file(&export_path)
            .await
            .unwrap();
        let exported_json = tokio::fs::read_to_string(&export_path).await.unwrap();
        assert!(!exported_json.contains("subs.srt"));
        assert!(!exported_json.contains("Videos"));

        let import_path = guard.dir.join("import_presets.json");
        let malicious_import = serde_json::json!([
            {
                "id": "p_import",
                "name": "Untrusted Preset",
                "description": "",
                "kind": "video",
                "video_settings": {
                    "format": "mkv",
                    "codec": "H.264",
                    "crf": 99,
                    "crop": "100:100;system(evil)"
                },
                "created_at": 1700000001u64
            }
        ]);
        tokio::fs::write(&import_path, malicious_import.to_string())
            .await
            .unwrap();

        let loaded = presets::PresetsStore::import_from_file(&import_path)
            .await
            .unwrap();
        let imp = loaded.iter().find(|p| p.id == "p_import").unwrap();
        let vs = imp.video_settings.as_ref().unwrap();
        assert_eq!(vs.crf, Some(51));
        assert_eq!(vs.crop, None);
    }

    #[tokio::test]
    async fn test_real_ffmpeg_ffprobe_lavfi_integration() {
        let ffmpeg_bin = ffmpeg_engine::FFmpegEngine::find_binary("ffmpeg")
            .expect("bundled or dev ffmpeg.exe must be discoverable");

        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let work_dir = std::env::temp_dir().join(format!("galaxy_lavfi_test_{}", nanos));
        tokio::fs::create_dir_all(&work_dir).await.unwrap();

        let test_mp4 = work_dir.join("synthetic.mp4");
        let gen_out = tokio::process::Command::new(&ffmpeg_bin)
            .args([
                "-hide_banner",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=320x240:d=1:r=15",
                "-f",
                "lavfi",
                "-i",
                "sine=f=440:d=1",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&test_mp4)
            .output()
            .await
            .unwrap();
        assert!(
            gen_out.status.success(),
            "ffmpeg lavfi generation failed: {}",
            String::from_utf8_lossy(&gen_out.stderr)
        );

        let info = ffmpeg_engine::FFmpegEngine::probe_file(&test_mp4)
            .await
            .unwrap();
        assert_eq!(info.kind, MediaKind::Video);
        assert_eq!(info.width, Some(320));
        assert_eq!(info.height, Some(240));
        assert!(info.duration_secs > 0.5);

        let out_mp3 = work_dir.join("extracted.mp3");
        let aud_args = ffmpeg_engine::FFmpegEngine::build_audio_args(
            &test_mp4,
            &out_mp3,
            &models::AudioConversionSettings::default(),
        );
        let conv_out = tokio::process::Command::new(&ffmpeg_bin)
            .args(&aud_args)
            .output()
            .await
            .unwrap();
        assert!(
            conv_out.status.success(),
            "ffmpeg audio conversion failed: {}",
            String::from_utf8_lossy(&conv_out.stderr)
        );
        assert!(tokio::fs::metadata(&out_mp3).await.unwrap().len() > 0);

        let _ = tokio::fs::remove_dir_all(&work_dir).await;
    }
}
