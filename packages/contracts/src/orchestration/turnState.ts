import {
  THREAD_SILENT_RUN_ACTIVITY_KIND,
  type OrchestrationLatestTurn,
  type OrchestrationLatestTurnState,
} from "./thread.ts";

/**
 * The states a turn can rest in. A turn is open only while it is `running`; every
 * other state is an ending, and the ones listed here are the only endings there
 * are. This is the one list: a new terminal state joins it, and nothing else
 * re-states it.
 */
export const TERMINAL_TURN_STATES = ["completed", "interrupted", "error"] as const;

export type TerminalTurnState = (typeof TERMINAL_TURN_STATES)[number];

const TERMINAL_TURN_STATE_SET: ReadonlySet<string> = new Set(TERMINAL_TURN_STATES);

export const isTerminalTurnState = (state: OrchestrationLatestTurnState): boolean =>
  TERMINAL_TURN_STATE_SET.has(state);

/**
 * The activities that end a turn without the provider ever replying. A turn that
 * ends this way keeps its row (its messages and checkpoint stay attached), but it
 * is not open: the provider stopped answering and nothing says it will start
 * again.
 *
 * The silence watchdog's report is the one that had a persisted event and was
 * still read as work, which is why it is named here rather than special-cased at
 * the call sites that ask whether a turn is open. `turn.silent.cleared` is its
 * reverse state: output came back, so the same turn is open again.
 */
export const TURN_ENDING_ACTIVITY_KINDS = [THREAD_SILENT_RUN_ACTIVITY_KIND] as const;

export type TurnEndingActivityKind = (typeof TURN_ENDING_ACTIVITY_KINDS)[number];

const TURN_ENDING_ACTIVITY_KIND_SET: ReadonlySet<string> = new Set(TURN_ENDING_ACTIVITY_KINDS);

export const isTurnEndingActivityKind = (kind: string): kind is TurnEndingActivityKind =>
  TURN_ENDING_ACTIVITY_KIND_SET.has(kind);

/** The turn fields a status decision reads; a null turn is a chat with no turn yet. */
export type TurnOpenness = Pick<OrchestrationLatestTurn, "state"> & {
  readonly silentAt?: string | null | undefined;
};

/**
 * Whether a turn has gone quiet: it is still running at the provider, but its
 * last named ending activity landed and nothing has cleared it. A silent turn is
 * the case this module exists for — the chat says "No response from <provider>",
 * so the turn is not evidence that the bot is working.
 */
export const isSilentTurn = (turn: TurnOpenness | null | undefined): boolean =>
  turn != null && turn.state === "running" && turn.silentAt != null;

/**
 * A turn is open iff it started and nothing terminal happened to it. Every caller
 * that asks "is this chat working?" — the bot status, the responder queue, the
 * provider turn start — asks it here, so a new way for a turn to end is added to
 * this module instead of being re-listed per call site.
 */
export const isOpenTurn = (turn: TurnOpenness | null | undefined): boolean =>
  turn != null && !isTerminalTurnState(turn.state) && !isSilentTurn(turn);
