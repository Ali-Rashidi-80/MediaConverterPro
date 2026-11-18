use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::constants::{CANCELLATION_GRACE_PERIOD_MS, MAX_STDERR_RING_BUFFER_LINES};
use crate::fs_guard::OutputFileGuard;
use crate::models::{AppError, TaskProgressUpdate};
use crate::progress_parser::ProgressState;

#[cfg(target_os = "windows")]
mod win_job {
    use std::os::windows::io::{AsRawHandle, RawHandle};
    use std::sync::LazyLock;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    struct JobHandle(HANDLE);

    // SAFETY: Windows Job Object handles are kernel handles safe to share across threads.
    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}

    impl Drop for JobHandle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
    }

    /// Singleton Windows Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
    /// so all child FFmpeg processes terminate automatically if the host process exits.
    pub struct WindowsJobObject {
        handle: Option<JobHandle>,
    }

    impl WindowsJobObject {
        fn new() -> Self {
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return Self { handle: None };
                }

                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                let ok = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0 {
                    CloseHandle(job);
                    return Self { handle: None };
                }

                Self {
                    handle: Some(JobHandle(job)),
                }
            }
        }

        pub fn assign_handle(&self, process_handle: RawHandle) -> bool {
            let Some(ref job) = self.handle else {
                return false;
            };
            unsafe { AssignProcessToJobObject(job.0, process_handle as HANDLE) != 0 }
        }

        pub fn assign_tokio_child(&self, child: &tokio::process::Child) -> bool {
            if let Some(handle) = child.raw_handle() {
                self.assign_handle(handle)
            } else {
                false
            }
        }

        #[allow(dead_code)]
        pub fn assign_std_child(&self, child: &std::process::Child) -> bool {
            self.assign_handle(child.as_raw_handle())
        }
    }

    static JOB_OBJECT: LazyLock<WindowsJobObject> = LazyLock::new(WindowsJobObject::new);

    pub fn attach_tokio(child: &tokio::process::Child) {
        let _ = JOB_OBJECT.assign_tokio_child(child);
    }

    #[allow(dead_code)]
    pub fn attach_std(child: &std::process::Child) {
        let _ = JOB_OBJECT.assign_std_child(child);
    }
}

/// Attaches a spawned `tokio::process::Child` to the global Windows Job Object
/// so orphaned subprocesses are killed when the parent process exits.
pub fn attach_to_job_object(child: &tokio::process::Child) {
    #[cfg(target_os = "windows")]
    win_job::attach_tokio(child);
    #[cfg(not(target_os = "windows"))]
    let _ = child;
}

/// Attaches a spawned `std::process::Child` to the global Windows Job Object.
#[allow(dead_code)]
pub fn attach_std_to_job_object(child: &std::process::Child) {
    #[cfg(target_os = "windows")]
    win_job::attach_std(child);
    #[cfg(not(target_os = "windows"))]
    let _ = child;
}

/// Parameters for a guarded FFmpeg conversion run.
pub struct FfmpegConversionJob<'a> {
    pub ffmpeg_path: &'a Path,
    pub args: &'a [String],
    pub target_dir: &'a Path,
    pub final_filename: &'a str,
    pub job_id: &'a str,
    pub total_duration_secs: f64,
    pub cancel_token: CancellationToken,
    pub pending_updates: Arc<Mutex<Vec<TaskProgressUpdate>>>,
}

pub struct ProcessRunner;

impl ProcessRunner {
    /// Runs an FFmpeg conversion guarded by `OutputFileGuard`, Job Object attachment,
    /// lossy UTF-8 progress/stderr reading, and graceful cancellation.
    /// Returns `(committed_output_path, measured_speed)`.
    pub async fn run_ffmpeg_conversion(
        job: FfmpegConversionJob<'_>,
    ) -> Result<(PathBuf, f32), AppError> {
        let FfmpegConversionJob {
            ffmpeg_path,
            args,
            target_dir,
            final_filename,
            job_id,
            total_duration_secs,
            cancel_token,
            pending_updates,
        } = job;
        if cancel_token.is_cancelled() {
            return Err(AppError::JobCancelled);
        }

        // 1. Prepare Two-Phase File Guard
        let mut file_guard = OutputFileGuard::new(target_dir, final_filename, job_id).await?;
        let temp_output_path = file_guard.temp_path.clone();

        // 2. Redirect last argument (output path) to the temporary `.galaxy_part_*` path
        let mut final_args = args.to_vec();
        if let Some(last) = final_args.last_mut() {
            *last = temp_output_path.to_string_lossy().to_string();
        }

        // 3. Setup command with Windows process flags and piped streams
        let mut cmd = Command::new(ffmpeg_path);
        cmd.args(&final_args);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        cmd.kill_on_drop(true);

        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(0x08000000 | 0x00004000); // CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS
        }

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                file_guard.abort_cleanup().await;
                return Err(AppError::Internal(format!(
                    "Failed to spawn FFmpeg process: {}",
                    e
                )));
            }
        };

        attach_to_job_object(&child);

        let mut stdin = child.stdin.take();
        let stdout = match child.stdout.take() {
            Some(s) => s,
            None => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                file_guard.abort_cleanup().await;
                return Err(AppError::Internal("Failed to access process stdout".into()));
            }
        };
        let stderr = match child.stderr.take() {
            Some(s) => s,
            None => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                file_guard.abort_cleanup().await;
                return Err(AppError::Internal("Failed to access process stderr".into()));
            }
        };

        // 4. Concurrently consume stdout (progress) and stderr (O(1) ring buffer) using raw bytes
        let mut stdout_reader = BufReader::new(stdout);
        let mut stderr_reader = BufReader::new(stderr);

        let stderr_log = Arc::new(Mutex::new(VecDeque::<String>::with_capacity(
            MAX_STDERR_RING_BUFFER_LINES,
        )));
        let stderr_log_clone = Arc::clone(&stderr_log);

        let stderr_drain_handle = tauri::async_runtime::spawn(async move {
            let mut buf = Vec::with_capacity(512);
            loop {
                buf.clear();
                match stderr_reader.read_until(b'\n', &mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let line = String::from_utf8_lossy(&buf)
                            .trim_end_matches(['\r', '\n'])
                            .to_string();
                        if !line.is_empty() {
                            let mut guard = stderr_log_clone.lock();
                            if guard.len() >= MAX_STDERR_RING_BUFFER_LINES {
                                guard.pop_front();
                            }
                            guard.push_back(line);
                        }
                    }
                }
            }
        });

        let started_at = Instant::now();
        let mut progress_state = ProgressState::default();
        let mut last_valid_speed: f32 = 0.0;
        let mut stdout_buf = Vec::with_capacity(256);

        loop {
            stdout_buf.clear();
            tokio::select! {
                biased;
                _ = cancel_token.cancelled() => {
                    if let Some(mut sin) = stdin.take() {
                        let _ = sin.write_all(b"q\n").await;
                        let _ = sin.flush().await;
                        drop(sin);
                    }
                    let grace = Duration::from_millis(CANCELLATION_GRACE_PERIOD_MS);
                    if tokio::time::timeout(grace, child.wait()).await.is_err() {
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                    }
                    let _ = stderr_drain_handle.await;
                    file_guard.abort_cleanup().await;
                    return Err(AppError::JobCancelled);
                }
                read_res = stdout_reader.read_until(b'\n', &mut stdout_buf) => {
                    match read_res {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let line = String::from_utf8_lossy(&stdout_buf)
                                .trim_end_matches(['\r', '\n'])
                                .to_string();
                            progress_state.parse_line(&line);
                            if progress_state.speed > 0.0 && progress_state.speed.is_finite() {
                                last_valid_speed = progress_state.speed;
                            }
                            let update = progress_state.calculate_update(job_id, total_duration_secs);
                            let mut guard = pending_updates.lock();
                            if let Some(pos) = guard.iter().position(|u| u.job_id == job_id) {
                                guard[pos] = update;
                            } else {
                                guard.push(update);
                            }
                        }
                    }
                }
            }
        }

        // Wait for child to exit (with cancellation race protection while draining exit status)
        let (conversion_success, exit_code) = tokio::select! {
            biased;
            _ = cancel_token.cancelled() => {
                if let Some(mut sin) = stdin.take() {
                    let _ = sin.write_all(b"q\n").await;
                    let _ = sin.flush().await;
                    drop(sin);
                }
                let grace = Duration::from_millis(CANCELLATION_GRACE_PERIOD_MS);
                if tokio::time::timeout(grace, child.wait()).await.is_err() {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                }
                let _ = stderr_drain_handle.await;
                file_guard.abort_cleanup().await;
                return Err(AppError::JobCancelled);
            }
            wait_res = child.wait() => {
                match wait_res {
                    Ok(status) => (status.success(), status.code()),
                    Err(e) => {
                        let _ = stderr_drain_handle.await;
                        file_guard.abort_cleanup().await;
                        return Err(AppError::Internal(format!("Failed to wait for process exit: {}", e)));
                    }
                }
            }
        };

        let _ = stderr_drain_handle.await;

        if cancel_token.is_cancelled() {
            file_guard.abort_cleanup().await;
            return Err(AppError::JobCancelled);
        }

        if conversion_success {
            let committed_path = file_guard.commit().await?;
            let elapsed_secs = started_at.elapsed().as_secs_f64().max(0.001);
            let measured_speed = if last_valid_speed > 0.0 && last_valid_speed.is_finite() {
                last_valid_speed
            } else if total_duration_secs > 0.0 {
                (total_duration_secs / elapsed_secs) as f32
            } else {
                1.0
            };
            Ok((committed_path, measured_speed))
        } else {
            file_guard.abort_cleanup().await;
            let last_error_log = {
                let guard = stderr_log.lock();
                Self::extract_ffmpeg_error(&guard)
            };
            Err(AppError::FfmpegExecutionError {
                exit_code,
                last_error_log,
            })
        }
    }

    pub(crate) fn extract_ffmpeg_error(lines: &VecDeque<String>) -> String {
        let best_line = lines.iter().rev().find_map(|l| {
            let text = l.trim();
            if text.is_empty() || text.contains("time=") || text.starts_with("frame=") {
                return None;
            }
            let lower = text.to_lowercase();
            if lower.contains("error")
                || lower.contains("invalid")
                || lower.contains("failed")
                || lower.contains("unable")
                || lower.contains("not found")
                || lower.contains("does not contain")
                || lower.contains("no such file")
                || lower.contains("concurrent")
                || lower.contains("unsupported")
            {
                Some(text.to_string())
            } else {
                None
            }
        });

        let all_logs = lines.iter().cloned().collect::<Vec<_>>().join("\n");
        if let Some(err) = best_line {
            format!("Error: {}\n\n--- Full FFmpeg Log ---\n{}", err, all_logs)
        } else {
            all_logs
        }
    }
}
