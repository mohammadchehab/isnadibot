/**
 * How long a provider may legitimately stay quiet before the silence watchdog
 * treats its turn as abandoned, declared per provider.
 *
 * The number is a statement about the provider, not about the server: Codex,
 * Claude, Grok, Kimi and OpenCode do not go quiet for the same reasons or for
 * the same length, so one global window is wrong in both directions — it would
 * end a healthy turn during a long build on a chatty provider and leave a
 * genuinely stuck turn open just as long on a quiet one.
 *
 * The basis for each number is written next to it. The question it answers is
 * **not** "how long does a turn take"; it is "what is the longest period this
 * provider can emit nothing while it is still alive". A provider whose basis
 * cannot be stated has no declared ceiling and gets
 * {@link CONSERVATIVE_LIVENESS_WINDOW_MS} until someone measures it.
 *
 * @module provider/LivenessWindow
 */
import { ProviderDriverKind } from "@isnadi/contracts";

/**
 * The declared ceiling is multiplied by this before it becomes the window the
 * watchdog waits. A turn that lands exactly on the ceiling is still alive, so
 * the window has to be longer than the ceiling, not equal to it.
 */
export const LIVENESS_SAFETY_FACTOR = 2;

/**
 * The shortest window any provider can get, so a chatty provider cannot be
 * given one so short that a slow tool call trips it.
 */
export const MIN_LIVENESS_WINDOW_MS = 5 * 60 * 1_000;

/**
 * The window for a provider with no stated ceiling — a driver whose author has
 * not measured how long it can stay quiet, or a driver this build does not know.
 * Long on purpose: ending a turn that is merely quiet is a lie about work that
 * is still happening, so an unmeasured provider errs towards leaving the turn
 * open.
 */
export const CONSERVATIVE_LIVENESS_WINDOW_MS = 30 * 60 * 1_000;

/**
 * The longest period each provider can legitimately emit nothing while its turn
 * is still alive. Every entry carries the sentence that justifies it; an entry
 * without one belongs in the default instead.
 */
const PROVIDER_SILENT_CEILING_MS: Partial<Record<ProviderDriverKind, number>> = {
  /**
   * Claude reports `tool_progress` heartbeats while a tool runs, so most long
   * tools are not silent at all. A tool that reports no progress — a plain
   * shell command — emits nothing between its start and its result, and Claude
   * Code caps a single shell call at 10 minutes (`BASH_MAX_TIMEOUT_MS`). So the
   * longest legitimate silence is one capped tool call: 10 minutes.
   */
  [ProviderDriverKind.make("claudeAgent")]: 10 * 60 * 1_000,
};

/** How long this provider may be silent before its turn is treated as abandoned. */
export const livenessWindowMsFor = (provider: ProviderDriverKind): number => {
  const ceiling = PROVIDER_SILENT_CEILING_MS[provider];

  return ceiling === undefined
    ? CONSERVATIVE_LIVENESS_WINDOW_MS
    : Math.max(MIN_LIVENESS_WINDOW_MS, ceiling * LIVENESS_SAFETY_FACTOR);
};
