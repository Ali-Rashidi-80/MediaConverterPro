use crate::constants::PROGRESS_EMITTER_INTERVAL_MS;
use crate::models::TaskProgressUpdate;
use parking_lot::Mutex;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct ProgressState {
    pub out_time_us: i64,
    pub fps: f32,
    pub speed: f32,
    pub frame: u64,
}

impl ProgressState {
    pub fn parse_line(&mut self, line: &str) {
        let trimmed = line.trim();
        if let Some((k, v)) = trimmed.split_once('=') {
            let key = k.trim();
            let val = v.trim();
            match key {
                "out_time_us" => {
                    if let Ok(us) = val.parse::<i64>() {
                        self.out_time_us = us.max(0);
                    }
                }
                "fps" => {
                    self.fps = val.parse::<f32>().unwrap_or(0.0);
                }
                "speed" => {
                    let cleaned = val.trim_end_matches('x').trim();
                    self.speed = cleaned.parse::<f32>().unwrap_or(0.0);
                }
                "frame" => {
                    self.frame = val.parse::<u64>().unwrap_or(0);
                }
                _ => {}
            }
        }
    }

    pub fn calculate_update(&self, job_id: &str, total_duration_secs: f64) -> TaskProgressUpdate {
        let current_secs = (self.out_time_us as f64) / 1_000_000.0;
        let percentage = if total_duration_secs > 0.0 {
            ((current_secs / total_duration_secs) * 100.0).clamp(0.0, 100.0) as f32
        } else {
            0.0
        };

        let eta_seconds = if self.speed > 0.05 && total_duration_secs > current_secs {
            ((total_duration_secs - current_secs) / (self.speed as f64)).max(0.0) as u64
        } else {
            0
        };

        TaskProgressUpdate {
            job_id: job_id.to_string(),
            percentage,
            fps: self.fps,
            speed: self.speed,
            eta_seconds,
        }
    }
}

pub async fn run_batch_progress_emitter(
    app: AppHandle,
    pending_updates: Arc<Mutex<Vec<TaskProgressUpdate>>>,
) {
    let mut interval = tokio::time::interval(std::time::Duration::from_millis(
        PROGRESS_EMITTER_INTERVAL_MS,
    ));
    loop {
        interval.tick().await;
        let batch: Vec<TaskProgressUpdate> = {
            let mut guard = pending_updates.lock();
            if guard.is_empty() {
                continue;
            }
            guard.drain(..).collect()
        };

        if !batch.is_empty() {
            let _ = app.emit("tasks_batch_progress", &batch);
        }
    }
}
