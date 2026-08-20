import { useEffect, useRef, useState } from "react";

import { computeRevealStep } from "@/agent-stream/text-reveal";
import type { MarkdownPhase } from "@/components/markdown/fence/types";

/**
 * Returns the prefix of `text` that should be painted right now.
 *
 * The first text this hook sees is revealed whole. Only growth is paced, which is
 * what makes every non-streaming path — history hydration, timeline replay, a
 * virtualized row remounting on scroll, a finished message — render complete on
 * first paint without a special case. Once `phase` leaves "streaming" the reveal
 * snaps, so a completed turn is never left with characters in hand.
 *
 * See @/agent-stream/text-reveal for why the rate is derived from the backlog.
 */
export function useRevealedText(text: string, phase: MarkdownPhase): string {
  const [revealedLength, setRevealedLength] = useState(text.length);
  const revealedRef = useRef(text.length);
  const frameRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef<number | null>(null);

  // A shorter string means this slot is showing a different message than the one
  // the reveal position belongs to. Clamp instead of slicing past the end.
  if (revealedRef.current > text.length) {
    revealedRef.current = text.length;
  }

  useEffect(() => {
    const snap = () => {
      lastFrameAtRef.current = null;
      if (revealedRef.current === text.length) {
        return;
      }
      revealedRef.current = text.length;
      setRevealedLength(text.length);
    };

    if (phase !== "streaming") {
      snap();
      return;
    }
    if (revealedRef.current >= text.length) {
      lastFrameAtRef.current = null;
      return;
    }
    if (typeof requestAnimationFrame !== "function") {
      snap();
      return;
    }

    const tick = (timestamp: number) => {
      frameRef.current = null;
      const previous = lastFrameAtRef.current;
      lastFrameAtRef.current = timestamp;
      // No previous frame to measure against yet: assume one frame at 60Hz rather
      // than burning this frame on nothing.
      const elapsedMs = previous === null ? 16 : timestamp - previous;

      const step = computeRevealStep({
        backlog: text.length - revealedRef.current,
        elapsedMs,
      });
      if (step > 0) {
        revealedRef.current = Math.min(text.length, revealedRef.current + step);
        setRevealedLength(revealedRef.current);
      }
      if (revealedRef.current < text.length) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [text, phase]);

  return revealedLength >= text.length ? text : text.slice(0, revealedLength);
}
