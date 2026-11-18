import { TRANSLATIONS } from '../i18n/translations';

export interface SerializedAppError {
  kind: string;
  payload?: unknown;
}

const isRecord = (val: unknown): val is Record<string, unknown> =>
  typeof val === 'object' && val !== null;

const tryParseAppError = (err: unknown): SerializedAppError | null => {
  if (isRecord(err) && typeof err.kind === 'string') {
    return { kind: err.kind, payload: err.payload };
  }
  if (typeof err === 'string') {
    const trimmed = err.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isRecord(parsed) && typeof parsed.kind === 'string') {
          return { kind: parsed.kind, payload: parsed.payload };
        }
      } catch {
        // Not valid JSON; treat as plain string below
      }
    }
  }
  return null;
};

/**
 * Returns true if the given Tauri/Rust error represents a user-initiated cancellation.
 */
export const isJobCancelledError = (err: unknown): boolean => {
  const parsed = tryParseAppError(err);
  if (parsed?.kind === 'JobCancelled') {
    return true;
  }

  let text = '';
  if (typeof err === 'string') {
    text = err;
  } else if (err instanceof Error) {
    text = err.message;
  } else if (isRecord(err) && typeof err.message === 'string') {
    text = err.message;
  } else if (err !== undefined && err !== null) {
    try {
      text = JSON.stringify(err);
    } catch {
      text = String(err);
    }
  }

  const lower = text.toLowerCase();
  return lower.includes('jobcancelled') || lower.includes('cancelled') || lower.includes('canceled');
};

/**
 * Formats a Tauri `AppError`, `Error`, or raw rejection into a clean localized user-facing message.
 */
export const parseAppError = (err: unknown, lang: 'fa' | 'en'): string => {
  const t = TRANSLATIONS[lang].errors;
  const parsed = tryParseAppError(err);

  if (parsed) {
    const { kind, payload } = parsed;
    switch (kind) {
      case 'FfmpegBinaryNotFound':
        return t.ffmpegBinaryNotFound;
      case 'JobCancelled':
        return t.jobCancelled;
      case 'FileNotFound': {
        const path = typeof payload === 'string' ? payload : '';
        return path ? `${t.fileNotFound}: ${path}` : t.fileNotFound;
      }
      case 'FfmpegExecutionError': {
        const p = isRecord(payload) ? payload : {};
        const exitCode = typeof p.exit_code === 'number' ? p.exit_code : null;
        const log = typeof p.last_error_log === 'string' ? p.last_error_log.trim() : '';
        const codePart = exitCode !== null ? ` (${t.exitCodeLabel}: ${exitCode})` : '';
        return log ? `${t.ffmpegExecutionError}${codePart}\n${log}` : `${t.ffmpegExecutionError}${codePart}`;
      }
      case 'GpuSessionExhausted': {
        const detail = typeof payload === 'string' ? payload.trim() : '';
        return detail ? `${t.gpuSessionExhausted}: ${detail}` : t.gpuSessionExhausted;
      }
      case 'ImageBombDetected': {
        const p = isRecord(payload) ? payload : {};
        const width = typeof p.width === 'number' ? p.width : undefined;
        const height = typeof p.height === 'number' ? p.height : undefined;
        if (width !== undefined && height !== undefined) {
          return `${t.imageBombDetected} (${width}×${height})`;
        }
        return t.imageBombDetected;
      }
      case 'EncodingCorrupted': {
        const detail = typeof payload === 'string' ? payload.trim() : '';
        return detail ? `${t.encodingCorrupted}: ${detail}` : t.encodingCorrupted;
      }
      case 'Validation': {
        const detail = typeof payload === 'string' ? payload.trim() : '';
        return detail ? `${t.validation}: ${detail}` : t.validation;
      }
      case 'SecurityViolation': {
        const detail = typeof payload === 'string' ? payload.trim() : '';
        return detail ? `${t.securityViolation}: ${detail}` : t.securityViolation;
      }
      case 'Io': {
        const p = isRecord(payload) ? payload : {};
        const msg = typeof p.message === 'string' ? p.message.trim() : '';
        const path = typeof p.path === 'string' ? p.path.trim() : '';
        if (msg && path) return `${t.io}: ${msg} (${path})`;
        if (msg) return `${t.io}: ${msg}`;
        if (path) return `${t.io} (${path})`;
        return t.io;
      }
      case 'Internal': {
        const detail = typeof payload === 'string' ? payload.trim() : '';
        return detail ? `${t.internal}: ${detail}` : t.internal;
      }
      default: {
        const detail = typeof payload === 'string' ? payload : isRecord(payload) ? JSON.stringify(payload) : '';
        return detail ? `${kind}: ${detail}` : kind;
      }
    }
  }

  if (err instanceof Error) {
    return err.message || t.unknown;
  }

  if (typeof err === 'string') {
    const trimmed = err.trim();
    return trimmed || t.unknown;
  }

  if (isRecord(err) && typeof err.message === 'string' && err.message.trim()) {
    return err.message.trim();
  }

  if (err === undefined || err === null) {
    return t.unknown;
  }

  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
};
