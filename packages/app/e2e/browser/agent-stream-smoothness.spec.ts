import { test, expect } from "../support/fixtures";
import { awaitAssistantMessage } from "../support/helpers/agent-stream";
import { startRunningMockAgent } from "../support/helpers/composer";
import { computePercentile, round2 } from "../support/helpers/terminal-perf";

/**
 * Streaming smoothness, measured on the path the user actually sees.
 *
 * The mock provider's "bursty-stream" model emits tokens in uneven runs separated
 * by idle gaps, which is how real models arrive. Two numbers come out of a run:
 *
 * - charsPerFrameCv — coefficient of variation of characters painted per frame.
 *   This is the smoothness metric. Painting deltas as they land tracks the arrival
 *   lumps, so this number is high; pacing the reveal flattens it.
 * - updateGapP95Ms — how long the text can sit unchanged mid-stream. This is the
 *   stall metric, and it guards against buying smoothness with lag.
 *
 * Budgets are deliberately loose. This spec exists to catch a regression in the
 * shape of the stream, not to pin exact numbers on shared CI hardware.
 */

const SAMPLE_WINDOW_MS = 6_000;
const CHARS_PER_FRAME_CV_BUDGET = 2;
const UPDATE_GAP_P95_BUDGET_MS = 250;
const RUN_AGENT_STREAM_PERF = process.env.PASEO_AGENT_STREAM_PERF_E2E === "1";
const agentStreamPerfDescribe = RUN_AGENT_STREAM_PERF ? test.describe : test.describe.skip;

interface FrameSample {
  timestampMs: number;
  length: number;
}

agentStreamPerfDescribe("Agent stream smoothness", () => {
  test("reveals bursty model output at a steady rate", async ({ page }, testInfo) => {
    test.setTimeout(120_000);

    const agent = await startRunningMockAgent(page, {
      prefix: "stream-smoothness-",
      model: "bursty-stream",
      prompt: "Stream bursty output for smoothness measurement.",
    });
    try {
      await awaitAssistantMessage(page);

      const frames = await page.evaluate(async (durationMs: number) => {
        const readLength = () => {
          const nodes = document.querySelectorAll('[data-testid="assistant-message"]');
          const last = nodes[nodes.length - 1];
          return last?.textContent?.length ?? 0;
        };

        const samples: FrameSample[] = [];
        await new Promise<void>((resolve) => {
          const start = performance.now();
          const tick = (now: number) => {
            samples.push({ timestampMs: now, length: readLength() });
            if (now - start >= durationMs) {
              resolve();
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        return samples;
      }, SAMPLE_WINDOW_MS);

      // Per-frame growth. A negative delta means the tail moved to a new assistant
      // message element, so that frame carries no usable measurement.
      const deltas: number[] = [];
      const updateGapsMs: number[] = [];
      let lastUpdateAtMs: number | null = null;

      for (let index = 1; index < frames.length; index += 1) {
        const previous = frames[index - 1];
        const current = frames[index];
        const delta = current.length - previous.length;
        if (delta < 0) {
          lastUpdateAtMs = current.timestampMs;
          continue;
        }
        deltas.push(delta);
        if (delta > 0) {
          if (lastUpdateAtMs !== null) {
            updateGapsMs.push(current.timestampMs - lastUpdateAtMs);
          }
          lastUpdateAtMs = current.timestampMs;
        }
      }

      const growthFrames = deltas.filter((delta) => delta > 0);
      expect(
        growthFrames.length,
        "the stream must actually produce text during the sample window",
      ).toBeGreaterThan(20);

      const mean = deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
      const variance = deltas.reduce((sum, delta) => sum + (delta - mean) ** 2, 0) / deltas.length;
      const charsPerFrameCv = mean === 0 ? Number.POSITIVE_INFINITY : Math.sqrt(variance) / mean;
      const updateGapP95Ms = updateGapsMs.length > 0 ? computePercentile(updateGapsMs, 95) : 0;

      const report = {
        sampleWindowMs: SAMPLE_WINDOW_MS,
        frames: frames.length,
        growthFrames: growthFrames.length,
        charsPainted: deltas.reduce((sum, delta) => sum + delta, 0),
        meanCharsPerFrame: round2(mean),
        maxCharsInOneFrame: Math.max(...deltas),
        charsPerFrameCv: round2(charsPerFrameCv),
        updateGapP50Ms: round2(updateGapsMs.length > 0 ? computePercentile(updateGapsMs, 50) : 0),
        updateGapP95Ms: round2(updateGapP95Ms),
      };

      await testInfo.attach("agent-stream-smoothness-report", {
        body: JSON.stringify(report, null, 2),
        contentType: "application/json",
      });

      console.log(
        `[perf] Stream smoothness: cv=${report.charsPerFrameCv} ` +
          `mean=${report.meanCharsPerFrame}c/frame max=${report.maxCharsInOneFrame}c ` +
          `gap p50=${report.updateGapP50Ms}ms p95=${report.updateGapP95Ms}ms`,
      );

      expect(
        charsPerFrameCv,
        `characters painted per frame should be steady (cv < ${CHARS_PER_FRAME_CV_BUDGET})`,
      ).toBeLessThan(CHARS_PER_FRAME_CV_BUDGET);
      expect(
        updateGapP95Ms,
        `the text should not stall (p95 gap < ${UPDATE_GAP_P95_BUDGET_MS}ms)`,
      ).toBeLessThan(UPDATE_GAP_P95_BUDGET_MS);
    } finally {
      await agent.cleanup();
    }
  });
});
