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
 *
 * Everything here is pure. The only thing the React hook adds is a frame clock,
 * which keeps the policy testable without a renderer.
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

const ZERO_WIDTH_JOINER = 0x200d;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Code points that attach to the character before them: combining marks,
 * variation selectors, the combining keycap, and emoji skin tone modifiers.
 * Cutting immediately before one of these strands it on its own.
 */
function isExtendingCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20f0) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) ||
    codePoint === ZERO_WIDTH_JOINER
  );
}

function codePointBefore(text: string, index: number): number | undefined {
  if (index <= 0) {
    return undefined;
  }
  const low = text.charCodeAt(index - 1);
  if (isLowSurrogate(low) && index >= 2 && isHighSurrogate(text.charCodeAt(index - 2))) {
    return text.codePointAt(index - 2);
  }
  return low;
}

function codePointWidth(codePoint: number): number {
  return codePoint > 0xffff ? 2 : 1;
}

/**
 * Pull a cut index back to somewhere it is safe to slice.
 *
 * A raw `slice` at an arbitrary index can strand a lone surrogate, which renders
 * as a replacement glyph, or split an emoji ZWJ sequence so a family briefly
 * appears as its individual members. Both are visible for a frame or two while
 * streaming, which is exactly the flicker the paced reveal is supposed to remove.
 *
 * This only moves the *rendered* boundary. The reveal counter stays monotonic, so
 * a long cluster can never stall the reveal — the next frame steps past it.
 */
export function clampToSafeRevealBoundary(text: string, index: number): number {
  if (index <= 0) {
    return 0;
  }
  if (index >= text.length) {
    return text.length;
  }

  let cut = index;

  // Never leave half of a surrogate pair behind.
  if (isLowSurrogate(text.charCodeAt(cut)) && isHighSurrogate(text.charCodeAt(cut - 1))) {
    cut -= 1;
  }

  // Back over anything that binds to the character on its left. Bounded so a
  // pathological run of combining marks can't spin.
  for (let guard = 0; guard < 64 && cut > 0; guard += 1) {
    const next = text.codePointAt(cut);
    const previous = codePointBefore(text, cut);
    if (previous === undefined) {
      break;
    }
    const cutsIntoCluster =
      (next !== undefined && isExtendingCodePoint(next)) || previous === ZERO_WIDTH_JOINER;
    if (!cutsIntoCluster) {
      break;
    }
    cut -= codePointWidth(previous);
  }

  return Math.max(0, cut);
}

export interface TextRevealState {
  /** The full text as the store knows it. */
  readonly target: string;
  /** How much of it has been released. Monotonic within a message. */
  readonly revealed: number;
}

/**
 * First sight of a text is revealed whole. Only growth is paced, which is what
 * makes history hydration, timeline replay, a virtualized row remounting on
 * scroll, and an already-finished message all render complete on first paint
 * without a special case for each.
 */
export function beginTextReveal(text: string): TextRevealState {
  return { target: text, revealed: text.length };
}

/** Point the reveal at newly arrived text without changing how much is shown. */
export function retargetTextReveal(state: TextRevealState, text: string): TextRevealState {
  if (state.target === text) {
    return state;
  }
  // A shorter string means this slot is showing a different message than the one
  // the reveal position belongs to.
  return { target: text, revealed: Math.min(state.revealed, text.length) };
}

/** Release one frame's worth of characters. */
export function advanceTextReveal(
  state: TextRevealState,
  elapsedMs: number,
  horizonMs?: number,
): TextRevealState {
  const step = computeRevealStep({
    backlog: state.target.length - state.revealed,
    elapsedMs,
    ...(horizonMs !== undefined ? { horizonMs } : {}),
  });
  if (step <= 0) {
    return state;
  }
  return { target: state.target, revealed: Math.min(state.target.length, state.revealed + step) };
}

/** Release everything, for when the turn ends and nothing may be held back. */
export function completeTextReveal(state: TextRevealState): TextRevealState {
  if (state.revealed >= state.target.length) {
    return state;
  }
  return { target: state.target, revealed: state.target.length };
}

export function isTextRevealSettled(state: TextRevealState): boolean {
  return state.revealed >= state.target.length;
}

/** What should actually be painted this frame. */
export function visibleRevealedText(state: TextRevealState): string {
  if (state.revealed >= state.target.length) {
    return state.target;
  }
  return state.target.slice(0, clampToSafeRevealBoundary(state.target, state.revealed));
}
