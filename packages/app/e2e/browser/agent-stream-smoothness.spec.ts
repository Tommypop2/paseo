import { test, expect } from "../support/fixtures";
import { awaitAssistantMessage } from "../support/helpers/agent-stream";
import { startRunningMockAgent } from "../support/helpers/composer";
import {
  sampleStreamFrames,
  summarizeStreamSmoothness,
} from "../support/helpers/stream-smoothness";

/**
 * Streaming smoothness, measured on the path the user actually sees.
 *
 * The mock provider's "bursty-stream" model emits tokens in uneven runs separated
 * by idle gaps, which is how real models arrive. Sampling and the statistics live
 * in ../support/helpers/stream-smoothness.ts, which also documents what the two
 * numbers mean.
 *
 * Budgets are deliberately loose. This spec exists to catch a regression in the
 * shape of the stream, not to pin exact numbers on shared CI hardware. For
 * reference, on a local dev daemon the paced reveal measures a CV around 1.3–1.5
 * against 2.7 when painting deltas as they arrive.
 */

const SAMPLE_WINDOW_MS = 6_000;
const CHARS_PER_FRAME_CV_BUDGET = 2;
const UPDATE_GAP_P95_BUDGET_MS = 250;
const RUN_AGENT_STREAM_PERF = process.env.PASEO_AGENT_STREAM_PERF_E2E === "1";
const agentStreamPerfDescribe = RUN_AGENT_STREAM_PERF ? test.describe : test.describe.skip;

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

      const samples = await sampleStreamFrames(page, { sampleWindowMs: SAMPLE_WINDOW_MS });
      const report = summarizeStreamSmoothness(samples, SAMPLE_WINDOW_MS);

      await testInfo.attach("agent-stream-smoothness-report", {
        body: JSON.stringify(report, null, 2),
        contentType: "application/json",
      });

      expect(
        report.growthFrames,
        "the stream must actually produce text during the sample window",
      ).toBeGreaterThan(20);
      expect(
        report.charsPerFrameCv,
        `characters painted per frame should be steady (cv < ${CHARS_PER_FRAME_CV_BUDGET})`,
      ).toBeLessThan(CHARS_PER_FRAME_CV_BUDGET);
      expect(
        report.updateGapP95Ms,
        `the text should not stall (p95 gap < ${UPDATE_GAP_P95_BUDGET_MS}ms)`,
      ).toBeLessThan(UPDATE_GAP_P95_BUDGET_MS);
    } finally {
      await agent.cleanup();
    }
  });
});
