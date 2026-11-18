use parking_lot::{Mutex, RwLock};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;

use crate::models::{AppError, MediaKind, PipelineTier};

#[derive(Clone)]
pub struct JobScheduler {
    gpu_semaphore: Arc<RwLock<Arc<Semaphore>>>,
    cpu_semaphore: Arc<RwLock<Arc<Semaphore>>>,
    io_semaphore: Arc<RwLock<Arc<Semaphore>>>,
    image_semaphore: Arc<RwLock<Arc<Semaphore>>>,
    cancellations: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl JobScheduler {
    /// Creates a new scheduler with smart initial concurrency limits.
    pub fn new(gpu_slots: usize, cpu_threads: usize) -> Self {
        let (gpu_permits, cpu_permits, io_permits, image_permits) =
            Self::compute_permits(gpu_slots, cpu_threads, 0, "smart");

        Self {
            gpu_semaphore: Arc::new(RwLock::new(Arc::new(Semaphore::new(gpu_permits)))),
            cpu_semaphore: Arc::new(RwLock::new(Arc::new(Semaphore::new(cpu_permits)))),
            io_semaphore: Arc::new(RwLock::new(Arc::new(Semaphore::new(io_permits)))),
            image_semaphore: Arc::new(RwLock::new(Arc::new(Semaphore::new(image_permits)))),
            cancellations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn compute_permits(
        gpu_slots: usize,
        cpu_threads: usize,
        max_parallel_jobs: usize,
        parallel_mode: &str,
    ) -> (usize, usize, usize, usize) {
        let mode = parallel_mode.trim().to_lowercase();
        if mode == "sequential" {
            return (1, 1, 1, 1);
        }

        let safe_threads = cpu_threads.max(1);
        let safe_gpu = gpu_slots.clamp(1, 2);

        if max_parallel_jobs > 0 {
            let cap = max_parallel_jobs.clamp(1, 16);
            return (
                safe_gpu.min(cap).max(1),
                cap.min(safe_threads.max(1)).max(1),
                cap.clamp(1, 8),
                cap.clamp(1, 8),
            );
        }

        match mode.as_str() {
            "parallel" => (
                safe_gpu,
                safe_threads.saturating_sub(1).clamp(1, 8),
                4,
                safe_threads.clamp(2, 6),
            ),
            _ => (
                safe_gpu,
                (safe_threads / 2).clamp(1, 4),
                4,
                (safe_threads / 2).clamp(2, 4),
            ),
        }
    }

    /// Dynamically updates semaphore capacities based on hardware and user settings.
    /// Existing in-flight permits remain valid until dropped; queued/new jobs pick up the new semaphores.
    pub fn reconfigure(
        &self,
        gpu_slots: usize,
        cpu_threads: usize,
        max_parallel_jobs: usize,
        parallel_mode: &str,
    ) {
        let (gpu_permits, cpu_permits, io_permits, image_permits) =
            Self::compute_permits(gpu_slots, cpu_threads, max_parallel_jobs, parallel_mode);

        *self.gpu_semaphore.write() = Arc::new(Semaphore::new(gpu_permits));
        *self.cpu_semaphore.write() = Arc::new(Semaphore::new(cpu_permits));
        *self.io_semaphore.write() = Arc::new(Semaphore::new(io_permits));
        *self.image_semaphore.write() = Arc::new(Semaphore::new(image_permits));
    }

    fn select_semaphore(&self, kind: MediaKind, tier: PipelineTier) -> Arc<Semaphore> {
        match kind {
            MediaKind::Image => Arc::clone(&self.image_semaphore.read()),
            MediaKind::Video => match tier {
                PipelineTier::Tier1 | PipelineTier::Tier2 => Arc::clone(&self.gpu_semaphore.read()),
                PipelineTier::Copy => Arc::clone(&self.io_semaphore.read()),
                PipelineTier::Cpu => Arc::clone(&self.cpu_semaphore.read()),
            },
            MediaKind::Audio => Arc::clone(&self.cpu_semaphore.read()),
        }
    }

    /// Acquires a permit for the specified media kind and pipeline tier.
    pub async fn acquire_permit(
        &self,
        kind: MediaKind,
        tier: PipelineTier,
    ) -> Result<OwnedSemaphorePermit, AppError> {
        let sem = self.select_semaphore(kind, tier);
        sem.acquire_owned()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    /// Acquires a permit while honoring cancellation so queued jobs exit immediately when cancelled.
    pub async fn acquire_permit_cancellable(
        &self,
        kind: MediaKind,
        tier: PipelineTier,
        cancel_token: &CancellationToken,
    ) -> Result<OwnedSemaphorePermit, AppError> {
        if cancel_token.is_cancelled() {
            return Err(AppError::JobCancelled);
        }
        let sem = self.select_semaphore(kind, tier);
        tokio::select! {
            biased;
            _ = cancel_token.cancelled() => Err(AppError::JobCancelled),
            res = sem.acquire_owned() => res.map_err(|e| AppError::Internal(e.to_string())),
        }
    }

    /// Registers a unique active job ID and returns its cancellation token.
    /// Rejects duplicate active job IDs with `AppError::Validation`.
    pub fn register_job(&self, job_id: &str) -> Result<CancellationToken, AppError> {
        if job_id.trim().is_empty() {
            return Err(AppError::Validation("Job ID cannot be empty".into()));
        }
        let mut guard = self.cancellations.lock();
        if guard.contains_key(job_id) {
            return Err(AppError::Validation(format!(
                "Job '{}' is already running",
                job_id
            )));
        }
        let token = CancellationToken::new();
        guard.insert(job_id.to_string(), token.clone());
        Ok(token)
    }

    /// Unregisters a completed or failed job ID.
    pub fn unregister_job(&self, job_id: &str) {
        self.cancellations.lock().remove(job_id);
    }

    /// Signals cancellation for a specific active job.
    pub fn cancel_job(&self, job_id: &str) -> bool {
        if let Some(token) = self.cancellations.lock().get(job_id) {
            token.cancel();
            true
        } else {
            false
        }
    }

    /// Signals cancellation for all active jobs.
    pub fn cancel_all(&self) {
        let guard = self.cancellations.lock();
        for token in guard.values() {
            token.cancel();
        }
    }
}
