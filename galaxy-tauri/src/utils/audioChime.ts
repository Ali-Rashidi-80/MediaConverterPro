/**
 * Play a short harmonic completion chime and dispose the AudioContext afterwards.
 */
export const playCompletionChime = (): void => {
  try {
    const webkitWindow = window as Window & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioCtx = window.AudioContext || webkitWindow.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    // Harmonic major triad chord (C5 - E5 - G5) with gentle attack and exponential decay
    const chord = [523.25, 659.25, 783.99];

    chord.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);
      gain.gain.setValueAtTime(0.06, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.07 + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.65);
    });

    setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 900);
  } catch (err) {
    console.warn('Audio chime playback omitted:', err);
  }
};
