// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useRevealedText } from "./use-revealed-text";

let frameCallbacks: Array<(timestamp: number) => void> = [];
let now = 0;

function installFrameClock(): void {
  frameCallbacks = [];
  now = 0;
  globalThis.requestAnimationFrame = ((callback: (timestamp: number) => void) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((handle: number) => {
    frameCallbacks[handle - 1] = () => {};
  }) as typeof cancelAnimationFrame;
}

// Run every frame callback queued so far, advancing a synthetic clock by one
// 60Hz frame each time.
function advanceFrames(count: number): void {
  for (let index = 0; index < count; index += 1) {
    const pending = frameCallbacks;
    frameCallbacks = [];
    now += 16;
    act(() => {
      for (const callback of pending) {
        callback(now);
      }
    });
  }
}

describe("useRevealedText", () => {
  beforeEach(() => {
    installFrameClock();
  });

  afterEach(() => {
    frameCallbacks = [];
  });

  it("reveals the first text it sees in full", () => {
    const { result } = renderHook(() => useRevealedText("already here", "streaming"));
    expect(result.current).toBe("already here");
    expect(frameCallbacks).toHaveLength(0);
  });

  it("paces growth instead of painting it whole", () => {
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useRevealedText(text, "streaming"),
      { initialProps: { text: "a" } },
    );

    rerender({ text: `a${"b".repeat(300)}` });
    expect(result.current).toBe("a");

    advanceFrames(1);
    expect(result.current.length).toBeGreaterThan(1);
    expect(result.current.length).toBeLessThan(301);
    expect(result.current.startsWith("ab")).toBe(true);
  });

  it("catches up to the full text if frames keep coming", () => {
    const full = `a${"b".repeat(200)}`;
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useRevealedText(text, "streaming"),
      { initialProps: { text: "a" } },
    );

    rerender({ text: full });
    advanceFrames(60);
    expect(result.current).toBe(full);
  });

  it("snaps to the full text when the turn stops streaming", () => {
    const full = `a${"b".repeat(500)}`;
    const { result, rerender } = renderHook(
      ({ text, phase }: { text: string; phase: "streaming" | "complete" }) =>
        useRevealedText(text, phase),
      { initialProps: { text: "a", phase: "streaming" as "streaming" | "complete" } },
    );

    rerender({ text: full, phase: "streaming" });
    advanceFrames(1);
    expect(result.current).not.toBe(full);

    rerender({ text: full, phase: "complete" });
    expect(result.current).toBe(full);
  });

  it("renders completed text whole without waiting for a frame", () => {
    const { result } = renderHook(() => useRevealedText("finished message", "complete"));
    expect(result.current).toBe("finished message");
    expect(frameCallbacks).toHaveLength(0);
  });

  it("only ever paints a prefix of the real text", () => {
    const full = "the quick brown fox jumps over the lazy dog";
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useRevealedText(text, "streaming"),
      { initialProps: { text: "the " } },
    );

    rerender({ text: full });
    for (let frame = 0; frame < 20; frame += 1) {
      expect(full.startsWith(result.current)).toBe(true);
      advanceFrames(1);
    }
  });

  it("clamps when the slot switches to a shorter message", () => {
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useRevealedText(text, "streaming"),
      { initialProps: { text: "a long streaming message" } },
    );

    rerender({ text: "short" });
    expect(result.current).toBe("short");
  });

  it("reveals text whole when no frame clock exists", () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    // @ts-expect-error -- exercising the no-rAF environment path
    globalThis.requestAnimationFrame = undefined;
    try {
      const { result, rerender } = renderHook(
        ({ text }: { text: string }) => useRevealedText(text, "streaming"),
        { initialProps: { text: "a" } },
      );
      rerender({ text: "a whole lot more text" });
      expect(result.current).toBe("a whole lot more text");
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });
});
