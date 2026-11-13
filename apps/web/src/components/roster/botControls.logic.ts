import type {
  BotId,
  EnvironmentId,
  OrchestrationSession,
  OrchestrationSessionStatus,
  OrchestrationThreadShell,
  ThreadId,
  TurnId,
} from "@isnadi/contracts";

/** The parts of a thread shell the bot controls read. */
export type BotControllableShell = Pick<
  OrchestrationThreadShell,
  "id" | "botId" | "session" | "archivedAt"
>;

/**
 * A shell the fleet-wide controls can act on. They span every environment the
 * client has loaded, so each target carries the environment its command goes
 * to; `EnvironmentThreadShell` already satisfies this.
 */
export type ScopedBotControllableShell = BotControllableShell & {
  readonly environmentId: EnvironmentId;
};

/** What the user can do to one bot right now. */
export interface BotControlAvailability {
  /** End the running turn; the chat history stays. */
  readonly interrupt: boolean;
  /** Type into the running turn: open the chat and use the composer. */
  readonly steer: boolean;
  /** Stop the live provider session so the next message starts a fresh context. */
  readonly clear: boolean;
}

export const NO_BOT_CONTROLS: BotControlAvailability = {
  interrupt: false,
  steer: false,
  clear: false,
};

/** A status the decider accepts a stop for without racing a turn that is still starting. */
const SETTLED_SESSION_STATUSES: ReadonlySet<OrchestrationSessionStatus> = new Set([
  "idle",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);

/**
 * A running turn is only interruptible when it can be named: the interrupt
 * carries the turn id so a late click cannot end the turn that replaced the
 * one the user saw. Mirrors `buildThreadTurnInterruptInput`.
 */
export function isBotTurnRunning(session: OrchestrationSession | null): boolean {
  return session?.status === "running" && session.activeTurnId !== null;
}

/**
 * Availability for one bot's own chat. An archived chat belongs to no bot's
 * roster row, and a session that is still starting is left alone: clearing it
 * would race the turn it is starting.
 */
export function resolveBotControlAvailability(
  shell: BotControllableShell | null,
): BotControlAvailability {
  if (shell === null || shell.archivedAt !== null) return NO_BOT_CONTROLS;

  const session = shell.session;
  const running = isBotTurnRunning(session);

  return {
    interrupt: running,
    steer: running,
    clear: session !== null && SETTLED_SESSION_STATUSES.has(session.status),
  };
}

/** The interrupt input for a bot's chat, or null while no turn is running. */
export function buildBotInterruptInput(
  shell: BotControllableShell | null,
): { threadId: ThreadId; turnId?: TurnId } | null {
  if (shell === null || !isBotTurnRunning(shell.session)) return null;

  const turnId = shell.session?.activeTurnId ?? null;

  return turnId === null ? { threadId: shell.id } : { threadId: shell.id, turnId };
}

/** The session-stop input for a bot's chat, or null when there is nothing live to clear. */
export function buildBotClearInput(
  shell: BotControllableShell | null,
): { threadId: ThreadId } | null {
  const session = shell?.session ?? null;

  if (shell === null || session === null) return null;

  if (!SETTLED_SESSION_STATUSES.has(session.status)) return null;

  return { threadId: shell.id };
}

/** One thread a fleet-wide control acts on. */
export interface BotControlTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly botId: BotId | null;
  readonly turnId: TurnId | null;
}

function liveShells(
  shells: readonly ScopedBotControllableShell[],
): readonly ScopedBotControllableShell[] {
  return shells.filter((shell) => shell.archivedAt === null);
}

/**
 * Every live turn across the loaded environments, bot chats and group chats
 * alike: "stop the fleet" means everything that is working right now.
 */
export function collectRunningTurns(
  shells: readonly ScopedBotControllableShell[],
): readonly BotControlTarget[] {
  return liveShells(shells)
    .filter((shell) => isBotTurnRunning(shell.session))
    .map((shell) => ({
      environmentId: shell.environmentId,
      threadId: shell.id,
      botId: shell.botId ?? null,
      turnId: shell.session?.activeTurnId ?? null,
    }));
}

/**
 * Every live provider session that is not mid-turn, so a fleet-wide clear never
 * races work in progress; interrupt first, then clear.
 */
export function collectClearableSessions(
  shells: readonly ScopedBotControllableShell[],
): readonly BotControlTarget[] {
  return liveShells(shells)
    .filter((shell) => buildBotClearInput(shell) !== null)
    .map((shell) => ({
      environmentId: shell.environmentId,
      threadId: shell.id,
      botId: shell.botId ?? null,
      turnId: null,
    }));
}
