import { describe, it, expect } from 'bun:test';
import { isJobCancelledError, parseAppError } from '../utils/errorParser';
import { TRANSLATIONS } from '../i18n/translations';

describe('errorParser', () => {
  it('detects JobCancelled errors in structured objects and JSON/text forms', () => {
    expect(isJobCancelledError({ kind: 'JobCancelled' })).toBe(true);
    expect(isJobCancelledError(JSON.stringify({ kind: 'JobCancelled' }))).toBe(true);
    expect(isJobCancelledError(new Error('JobCancelled by user'))).toBe(true);
    expect(isJobCancelledError('operation cancelled')).toBe(true);
    expect(isJobCancelledError({ kind: 'Validation', payload: 'bad field' })).toBe(false);
  });

  it('formats structured AppError variants into fa and en messages', () => {
    expect(parseAppError({ kind: 'FfmpegBinaryNotFound' }, 'en')).toBe(
      TRANSLATIONS.en.errors.ffmpegBinaryNotFound
    );
    expect(parseAppError({ kind: 'FfmpegBinaryNotFound' }, 'fa')).toBe(
      TRANSLATIONS.fa.errors.ffmpegBinaryNotFound
    );

    expect(
      parseAppError({ kind: 'Validation', payload: 'trim_end <= trim_start' }, 'en')
    ).toContain('trim_end <= trim_start');

    expect(
      parseAppError({ kind: 'SecurityViolation', payload: 'path outside root' }, 'fa')
    ).toContain('path outside root');

    expect(
      parseAppError({ kind: 'Io', payload: { message: 'Disk full', path: 'D:/out.mp4' } }, 'en')
    ).toContain('Disk full (D:/out.mp4)');

    expect(
      parseAppError(
        JSON.stringify({ kind: 'ImageBombDetected', payload: { width: 20000, height: 20000 } }),
        'en'
      )
    ).toContain('20000×20000');
  });

  it('handles unknown/empty inputs gracefully', () => {
    expect(parseAppError(undefined, 'en')).toBe(TRANSLATIONS.en.errors.unknown);
    expect(parseAppError(null, 'fa')).toBe(TRANSLATIONS.fa.errors.unknown);
    expect(parseAppError('', 'en')).toBe(TRANSLATIONS.en.errors.unknown);
    expect(parseAppError('raw failure', 'en')).toBe('raw failure');
  });
});
