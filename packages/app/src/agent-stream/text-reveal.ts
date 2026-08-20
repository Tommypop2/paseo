/**
 * Paced reveal for streaming assistant text.
 *
 * Deltas arrive lumpy: the daemon coalesces one message per 60ms window, carrying
 * however many characters the model happened to produce in that window. Painting
 * each delta as it lands makes the size of those lumps visible, which is what
 * reads as jagged. So arrival changes the *target* and the reveal rate is derived
 * from the backlog instead — a burst makes the text catch up faster, it doesn't
 * make it jump.
 *
 * The store keeps the full text. Only the rendered slice is paced, so copy,
 * selection, the chat outline, and scroll geometry all stay consistent with what
 * is on screen.
 */

// Backlog is drained over this horizon. Shorter feels more like the raw arrival
// pattern; longer adds lag the user can notice at the end of a turn.
export const TEXT_REVEAL_HORIZON_MS = 150;

// A frame's elapsed time is clamped to this before it is used, so a long stall
// (backgrounded tab, blocked main thread) doesn't produce a wild step from one
// enormous delta.
const MAX_ELAPSED_MS = 250;

/**
 * Characters to reveal on this frame. Proportional to the backlog, so the reveal
 * accelerates when the model runs ahead and settles when it doesn't, with a
 * one-character floor so the tail always finishes.
 */
export function computeRevealStep(input: {
  backlog: number;
  elapsedMs: number;
  horizonMs?: number;
}): number {
  const { backlog } = input;
  if (backlog <= 0) {
    return 0;
  }

  const horizonMs = input.horizonMs ?? TEXT_REVEAL_HORIZON_MS;
  if (horizonMs <= 0) {
    return backlog;
  }

  const elapsedMs = Math.min(Math.max(input.elapsedMs, 0), MAX_ELAPSED_MS);
  if (elapsedMs <= 0) {
    return 0;
  }
  if (elapsedMs >= horizonMs) {
    return backlog;
  }

  const step = Math.ceil((backlog * elapsedMs) / horizonMs);
  return Math.min(backlog, Math.max(1, step));
}
