# Silence watchdog

A running turn that stops producing output is reported as a typed silent-run state instead of a spinner that keeps claiming the bot is working. The watchdog never interrupts the turn. The user decides whether to wait or stop it.

## Where it runs

The watchdog lives in `ProviderRuntimeIngestion`, after provider events are normalized into `ProviderRuntimeEvent`s. Every provider passes through that point. Codex, Claude, Grok, Kimi For Coding, and OpenCode Go arrive through the Mastra `AgentController`, and standard OpenCode arrives through the legacy adapter bridge. None of the providers needs its own watchdog code.

The timer itself is `startSilenceWatchdog` in `apps/server/src/orchestration/SilenceWatchdog.ts`. It is a fiber forked into the ingestion scope, driven by a signal queue and `Clock`, so tests control it with `TestClock`. The silent interval is the named constant `SILENCE_WATCHDOG_SILENT_MS` (90 seconds).

## Lifecycle

1. `turn.started` starts one watchdog for the thread and turn. A newer turn on the same thread stops the previous watchdog first.
2. Every other runtime event for the turn counts as output and restarts the countdown. `turn.completed` and `turn.aborted` do not; they end the turn instead.
3. `request.opened` and `user-input.requested` pause the countdown while the bot waits on the user. The matching `request.resolved` and `user-input.resolved` resume it with a fresh countdown, so time spent waiting on the user never counts as silence.
4. After 90 seconds without output, the watchdog appends a `turn.silent` activity with a `ThreadSilentRunActivityPayload` (`provider`, `lastActivityAt`) and opens a `silence-watchdog-failure` inbox item for the bot.
5. When output resumes, it appends `turn.silent.cleared` and resolves the inbox item. The countdown starts again, so a later quiet stretch opens a new silent window.
6. `turn.completed`, `turn.aborted`, and an interrupted turn stop the watchdog and resolve the inbox item. `session.exited` stops every watchdog for the thread. Stopping never appends `turn.silent.cleared`, because the turn ending already clears the state on clients.

Silent and cleared reports run on a drainable worker inside ingestion, so the ingestion `drain` covers them and tests can wait on it instead of sleeping.

## What a silent turn means

A silent turn is not work in progress. The provider stopped answering, and nothing says it will start again, so every surface that asks "is this chat working?" must read it as no.

`turn.silent` is projected onto the turn row as `silentAt` (migration `085_ProjectionTurnSilentAt`), so the answer travels with the turn instead of needing the activity stream. Both projectors carry it: the SQL projection in `Layers/projection/Turns.ts` and the in-memory one in `projector/ThreadHistory.ts`, which is the decider's read model. The `threadTurns` projector subscribes to `thread.activity-appended` for exactly this, and its `eventTypes` allowlist in `ProjectionPipeline.ts` is a second place the set is enumerated — a new turn-ending activity needs the entry there too.

The predicate lives in one named place, `packages/contracts/src/orchestration/turnState.ts`:

- `TERMINAL_TURN_STATES` — `completed`, `interrupted`, `error`.
- `TURN_ENDING_ACTIVITY_KINDS` — the activities that end a turn with no provider reply. `turn.silent` is the first.
- `isOpenTurn` — a turn is open iff it is not terminal and not silent. Every caller asks this: bot status, the responder queue, and the provider turn start.

Three behaviors follow:

1. **Bot status.** `packages/shared/src/botStatus.ts` computes `working` from open turns, so a bot whose only running turn went silent reads Idle, not Busy. `held` still reads every running turn, because a silent parent waiting on a delegated child is held rather than idle.
2. **The responder queue advances.** A queued item behind a silent turn is no longer stuck behind a turn that will never answer.
3. **A new message takes over.** Before sending, the turn start interrupts a silent turn, so the message starts a fresh turn instead of steering into the dead one. That is why the user no longer has to press Stop first.

Silence is a **reversible mark on a running turn**, not a terminal state. `turn.silent.cleared` removes `silentAt` and the same turn is open again. This is deliberate: a literal terminal state would strand a turn that resumes after a long tool run.

## The mark expires

A mark that can be withdrawn can also be forgotten, and a turn nothing ends stays open forever. So the mark is provisional in both directions: it never ends the turn by itself, and it does not stand indefinitely. The watchdog waits `SILENT_TURN_LIVENESS_MS` (30 minutes, measured from the last provider activity, so it runs from the moment the notice appears) for output. If none arrives, `onExpired` settles the turn the way a provider error does: a `thread.session.set` with status `error`, `activeTurnId` null, and the typed reason `SILENT_TURN_EXPIRED_ERROR`. The session leaving `running` is what makes the turn terminal, and the silence inbox item resolves with it. A turn already ended, or a newer turn that took over, is left alone.

The window is deliberately far longer than the 90-second silent one. A single long tool call emits no provider events, and ending a turn that is merely quiet would be a lie about work still in progress. 30 minutes matches the inactivity window the provider session reaper already trusts for a session with no sign of life; once the turn is settled and `activeTurnId` is null, that reaper can also stop the session.

The watchdog only covers turns this process started. A mark that outlived a restart has no watchdog, and is settled by startup reconciliation below.

## Startup reconciliation

The silence report only exists if the watchdog got to run. `startupReconciliation` covers the rest: an open turn whose provider session did not survive the restart is settled into a terminal state with a typed reason, `ORPHANED_PROVIDER_TURN_ERROR`. A thread with no session row gets a synthesized error session so the projector settles its turn. Without this the invariant is only as good as every adapter's error path.

## Inbox deduplication

The incident key is `silence:<threadId>:<turnId>`, so a turn has at most one inbox item. `BotInboxService.ensureOpen` reopens the existing item for this kind even after an automatic resolve, as long as nobody acknowledged it. Repeated silent windows in one turn therefore bump `occurrenceCount` on the same item instead of adding rows. A chat with no bot records the silent-run state but opens no inbox item.

## Clients

`packages/client-runtime/src/silentRun.ts` exports `threadSilentRun(activities, turnId)`. It returns the provider, its display name, and the last output time when the latest silent-run activity for the running turn is `turn.silent`, and `null` otherwise. Web passes the result to `BotActivityStatus`, which replaces the working shimmer with "No response from <provider>" and a timer counted from the last output. Mobile shows the same state in the working row of the thread feed. Both clients keep silent-run activities out of the work log.
