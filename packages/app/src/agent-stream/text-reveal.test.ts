import { describe, expect, it } from "vitest";

import { computeRevealStep, TEXT_REVEAL_HORIZON_MS } from "./text-reveal";

describe("computeRevealStep", () => {
  it("reveals nothing when there is no backlog", () => {
    expect(computeRevealStep({ backlog: 0, elapsedMs: 16 })).toBe(0);
    expect(computeRevealStep({ backlog: -5, elapsedMs: 16 })).toBe(0);
  });

  it("drains the backlog over the horizon", () => {
    const backlog = 300;
    const step = computeRevealStep({ backlog, elapsedMs: TEXT_REVEAL_HORIZON_MS / 2 });
    expect(step).toBe(150);
  });

  it("reveals the whole backlog once a frame covers the horizon", () => {
    expect(computeRevealStep({ backlog: 42, elapsedMs: TEXT_REVEAL_HORIZON_MS })).toBe(42);
    expect(computeRevealStep({ backlog: 42, elapsedMs: TEXT_REVEAL_HORIZON_MS * 10 })).toBe(42);
  });

  it("scales the rate with the backlog so a faster model reveals faster", () => {
    const slow = computeRevealStep({ backlog: 20, elapsedMs: 16 });
    const fast = computeRevealStep({ backlog: 200, elapsedMs: 16 });
    expect(fast).toBeGreaterThan(slow);
  });

  it("always advances at least one character so the tail finishes", () => {
    expect(computeRevealStep({ backlog: 1, elapsedMs: 1 })).toBe(1);
    expect(computeRevealStep({ backlog: 2, elapsedMs: 0.01 })).toBe(1);
  });

  it("never overshoots the backlog", () => {
    for (const backlog of [1, 3, 7, 50]) {
      expect(computeRevealStep({ backlog, elapsedMs: 120 })).toBeLessThanOrEqual(backlog);
    }
  });

  it("reveals nothing when no time has passed", () => {
    expect(computeRevealStep({ backlog: 100, elapsedMs: 0 })).toBe(0);
    expect(computeRevealStep({ backlog: 100, elapsedMs: -16 })).toBe(0);
  });

  it("converges within a bounded number of frames at 60Hz", () => {
    let remaining = 500;
    let frames = 0;
    while (remaining > 0) {
      remaining -= computeRevealStep({ backlog: remaining, elapsedMs: 16 });
      frames += 1;
      expect(frames).toBeLessThan(120);
    }
    expect(remaining).toBe(0);
  });

  it("keeps per-frame steps smooth for a bursty arrival pattern", () => {
    // A lumpy arrival sequence: the daemon's coalescing window carries wildly
    // different character counts depending on model throughput.
    const arrivals = [4, 180, 6, 240, 2, 90, 300, 8];
    const steps: number[] = [];
    let backlog = 0;

    for (const arrival of arrivals) {
      backlog += arrival;
      // ~60ms of frames between coalesced flushes.
      for (let frame = 0; frame < 4; frame += 1) {
        const step = computeRevealStep({ backlog, elapsedMs: 16 });
        backlog -= step;
        steps.push(step);
      }
    }

    // Painting arrivals directly would swing from 2 to 300 characters in one
    // paint. Pacing keeps the largest single paint far below the largest arrival.
    expect(Math.max(...steps)).toBeLessThan(Math.max(...arrivals) / 2);
    expect(Math.min(...steps)).toBeGreaterThan(0);
  });
});
