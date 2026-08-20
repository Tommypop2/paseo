import type { Page } from "@playwright/test";

/**
 * Frame-level sampling of the streaming assistant message, and the two numbers
 * that describe how it reads:
 *
 * - `charsPerFrameCv` — coefficient of variation of characters painted per frame.
 *   This is the smoothness metric. Painting deltas as they land tracks the
 *   arrival lumps, so it is high; pacing the reveal flattens it.
 * - `updateGapP95Ms` — how long the text can sit unchanged mid-stream. This is
 *   the stall metric, and it is what stops smoothness being bought with lag.
 *
 * Both are needed. A stream that never updates is perfectly smooth.
 */

export interface StreamFrameSample {
  timestampMs: number;
  length: number;
}

export interface StreamSmoothnessReport {
  sampleWindowMs: number;
  frames: number;
  growthFrames: number;
  charsPainted: number;
  meanCharsPerFrame: number;
  maxCharsInOneFrame: number;
  charsPerFrameCv: number;
  updateGapP50Ms: number;
  updateGapP95Ms: number;
  updateGapMaxMs: number;
}

/**
 * Record the painted length of the last assistant message once per frame.
 *
 * Runs entirely in the page so the sampling clock is the same clock the reveal
 * runs on. Waits for the text to start moving first, so a slow model's
 * time-to-first-token is not counted as a stall.
 */
export async function sampleStreamFrames(
  page: Page,
  options: { sampleWindowMs: number; startTimeoutMs?: number },
): Promise<StreamFrameSample[]> {
  const startTimeoutMs = options.startTimeoutMs ?? 60_000;
  return await page.evaluate(
    async ({ sampleWindowMs, startTimeoutMs: waitMs }) => {
      const readLength = () => {
        const nodes = document.querySelectorAll('[data-testid="assistant-message"]');
        const last = nodes[nodes.length - 1];
        return last?.textContent?.length ?? 0;
      };

      const waitStart = performance.now();
      let base = readLength();
      await new Promise<void>((resolve) => {
        const poll = () => {
          const length = readLength();
          if (length > base + 20 || performance.now() - waitStart > waitMs) {
            resolve();
            return;
          }
          if (length < base) {
            base = length;
          }
          requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      });

      const samples: Array<{ timestampMs: number; length: number }> = [];
      await new Promise<void>((resolve) => {
        const start = performance.now();
        const tick = (now: number) => {
          samples.push({ timestampMs: now, length: readLength() });
          if (now - start >= sampleWindowMs) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return samples;
    },
    { sampleWindowMs: options.sampleWindowMs, startTimeoutMs },
  );
}

export function computePercentile(samples: readonly number[], percentile: number): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1)];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Reduce frame samples to the report. Frames outside the streaming window are
 * dropped: a negative delta means the tail moved to a new assistant message
 * element, and trailing idle means the turn ended mid-sample.
 */
export function summarizeStreamSmoothness(
  samples: readonly StreamFrameSample[],
  sampleWindowMs: number,
): StreamSmoothnessReport {
  const deltas: number[] = [];
  const gapsMs: number[] = [];
  let lastUpdateAtMs: number | null = null;
  let firstGrowth = -1;
  let lastGrowth = -1;

  for (let index = 1; index < samples.length; index += 1) {
    const delta = samples[index].length - samples[index - 1].length;
    if (delta < 0) {
      lastUpdateAtMs = samples[index].timestampMs;
      continue;
    }
    deltas.push(delta);
    if (delta > 0) {
      if (firstGrowth === -1) {
        firstGrowth = deltas.length - 1;
      }
      lastGrowth = deltas.length - 1;
      if (lastUpdateAtMs !== null) {
        gapsMs.push(samples[index].timestampMs - lastUpdateAtMs);
      }
      lastUpdateAtMs = samples[index].timestampMs;
    }
  }

  const active = firstGrowth === -1 ? [] : deltas.slice(firstGrowth, lastGrowth + 1);
  const charsPainted = active.reduce((sum, delta) => sum + delta, 0);
  const mean = active.length > 0 ? charsPainted / active.length : 0;
  const variance =
    active.length > 0
      ? active.reduce((sum, delta) => sum + (delta - mean) ** 2, 0) / active.length
      : 0;

  return {
    sampleWindowMs,
    frames: active.length,
    growthFrames: active.filter((delta) => delta > 0).length,
    charsPainted,
    meanCharsPerFrame: round2(mean),
    maxCharsInOneFrame: active.length > 0 ? Math.max(...active) : 0,
    charsPerFrameCv: mean === 0 ? Number.POSITIVE_INFINITY : round2(Math.sqrt(variance) / mean),
    updateGapP50Ms: round2(computePercentile(gapsMs, 50)),
    updateGapP95Ms: round2(computePercentile(gapsMs, 95)),
    updateGapMaxMs: gapsMs.length > 0 ? round2(Math.max(...gapsMs)) : 0,
  };
}
