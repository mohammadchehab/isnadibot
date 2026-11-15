import {
  CommandId,
  EventId,
  ThreadId,
  TurnId,
  type OrchestrationThreadShell,
  PROVIDER_DISPLAY_NAMES,
  THREAD_SILENT_RUN_ACTIVITY_KIND,
  THREAD_SILENT_RUN_CLEARED_ACTIVITY_KIND,
  TURN_WENT_SILENT_REFUSAL,
  type ProviderDriverKind,
  type ThreadSilentRunActivityPayload,
} from "@isnadi/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { makeDrainableWorker } from "@isnadi/shared/DrainableWorker";
import { livenessWindowMsFor } from "../../../provider/LivenessWindow.ts";
import { startSilenceWatchdog, type SilenceWatchdogHandle } from "../../SilenceWatchdog.ts";
import { resolveControllerBotId } from "../ProviderCommandReactor.ts";
import { providerTurnKey } from "./EventFields.ts";
import type { createDependencies } from "./Dependencies.ts";

/**
 * The typed reason for a turn whose silence outlived the provider's liveness window. Nothing else
 * will ever end that turn: the mark only ever clears on output, so without this a turn the provider
 * abandoned stays open forever and its chat reads as work that will never finish.
 *
 * Distinct from `ORPHANED_PROVIDER_TURN_ERROR`, which is the session-gone case: there the provider
 * died with its session, here the session is alive and the provider simply stopped. The remedy is
 * the same (try again), the diagnosis is not — collapsing them would destroy the only signal that
 * tells a server restart apart from a provider going quiet.
 */
export const TURN_WENT_SILENT_ERROR = "This turn stopped responding, so it was closed. Try again.";

export const createWatchdogs = Effect.fn("makeRuntimeWatchdogs")(function* ({
  botInbox,
  orchestrationEngine,
  projectionSnapshotQuery,
}: Pick<
  Effect.Success<ReturnType<typeof createDependencies>>,
  "botInbox" | "orchestrationEngine" | "projectionSnapshotQuery"
>) {
  const silenceWatchdogs = new Map<string, SilenceWatchdogHandle>();

  // Open requests per watched turn, so a duplicate or unmatched resolution cannot
  // resume a watchdog while another request still waits on the user.
  const silenceWaitingRequests = new Map<string, Set<string>>();

  const silenceIncidentKey = (threadId: ThreadId, turnId: TurnId) =>
    `silence:${threadId}:${turnId}`;

  const stopSilenceWatchdog = (threadId: ThreadId, turnId: TurnId) => {
    const key = providerTurnKey(threadId, turnId);
    const handle = silenceWatchdogs.get(key);

    if (!handle) return Effect.void;
    silenceWatchdogs.delete(key);
    silenceWaitingRequests.delete(key);

    return handle.stop;
  };

  const stopAllSilenceWatchdogs = (threadId: ThreadId) =>
    Effect.forEach(
      [...silenceWatchdogs.entries()].filter(([key]) => key.startsWith(`${threadId}:`)),
      ([key, handle]) =>
        Effect.sync(() => {
          silenceWatchdogs.delete(key);
          silenceWaitingRequests.delete(key);
        }).pipe(Effect.andThen(handle.stop)),
      { concurrency: 1, discard: true },
    );

  // Silent-run reports and their resolutions run in order on one worker, so a report
  // queued just before a turn ends can never reopen the incident the ending closed.
  const silenceReportWorker = yield* makeDrainableWorker((report: Effect.Effect<void>) => report);

  const resolveSilenceIncidents = (threadId: ThreadId) =>
    silenceReportWorker.enqueue(
      Effect.sync(() => {
        for (const incident of botInbox.list()) {
          if (
            incident.kind === "silence-watchdog-failure" &&
            incident.status === "open" &&
            incident.incidentKey.startsWith(`silence:${threadId}:`)
          ) {
            botInbox.resolve(incident.incidentKey);
          }
        }
      }),
    );

  const startTurnSilenceWatchdog = (
    thread: Pick<OrchestrationThreadShell, "id" | "botId" | "respondingBotId"> & {
      readonly title: string;
    },
    turnId: TurnId,
    provider: ProviderDriverKind,
  ) =>
    Effect.gen(function* () {
      // One turn runs per chat, so a new turn retires any watchdog left behind.
      yield* stopAllSilenceWatchdogs(thread.id);
      yield* resolveSilenceIncidents(thread.id);
      const botId = resolveControllerBotId(thread);
      const incidentKey = silenceIncidentKey(thread.id, turnId);
      const providerName = PROVIDER_DISPLAY_NAMES[provider] ?? provider;

      const appendSilenceActivity = (input: {
        readonly id: string;
        readonly kind: string;
        readonly summary: string;
        readonly payload: unknown;
      }) =>
        Effect.gen(function* () {
          const createdAt = DateTime.formatIso(yield* DateTime.now);
          yield* orchestrationEngine.dispatch({
            type: "thread.activity.append",
            commandId: CommandId.make(input.id),
            threadId: thread.id,
            activity: {
              id: EventId.make(input.id),
              tone: "info",
              kind: input.kind,
              summary: input.summary,
              payload: input.payload,
              turnId,
              createdAt,
            },
            createdAt,
          });
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to record silent-run state", {
              threadId: thread.id,
              turnId,
              cause: Cause.pretty(cause),
            }),
          ),
        );

      const handle = yield* startSilenceWatchdog({
        // How long this provider can legitimately say nothing is its own fact, not a server one.
        livenessWindowMs: livenessWindowMsFor(provider),
        callbacks: {
          onSilent: (lastActivityAtMs) =>
            silenceReportWorker.enqueue(
              Effect.gen(function* () {
                const payload: ThreadSilentRunActivityPayload = {
                  provider,
                  lastActivityAt: DateTime.formatIso(DateTime.makeUnsafe(lastActivityAtMs)),
                };

                yield* appendSilenceActivity({
                  id: `silence-watchdog:silent:${thread.id}:${turnId}:${lastActivityAtMs}`,
                  kind: THREAD_SILENT_RUN_ACTIVITY_KIND,
                  summary: `No response from ${providerName}`,
                  payload,
                });

                if (botId === null) return;
                const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
                const bot = snapshot.bots.find((candidate) => candidate.id === botId);

                if (!bot) return;
                // Keyed by chat and turn: a later silent window reopens the same item.
                yield* Effect.sync(() =>
                  botInbox.ensureOpen({
                    incidentKey,
                    kind: "silence-watchdog-failure",
                    botId,
                    botName: bot.name,
                    taskOrRoutine: thread.title,
                    lastFailure: `No response from ${providerName} for over a minute while the chat is running.`,
                    nextAction:
                      "Wait for it to continue, or stop the chat and send your message again. If it keeps happening, check the provider connection.",
                  }),
                );
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("failed to report silent run", {
                    threadId: thread.id,
                    turnId,
                    cause: Cause.pretty(cause),
                  }),
                ),
              ),
            ),
          onResumed: silenceReportWorker.enqueue(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;
              yield* appendSilenceActivity({
                id: `silence-watchdog:cleared:${thread.id}:${turnId}:${now}`,
                kind: THREAD_SILENT_RUN_CLEARED_ACTIVITY_KIND,
                summary: `${providerName} responded`,
                payload: { provider },
              });
              yield* Effect.sync(() => botInbox.resolve(incidentKey));
            }),
          ),
          // The mark expired, so the watchdog settles the turn itself: the session leaving
          // "running" is the final-terminal event, and it is what the checkpoint, the dispatcher
          // and every busy predicate already read. Nothing upstream will end this turn — the
          // provider is not talking and its session is still alive. A turn that already ended, or
          // a newer turn that took over, is left alone.
          onExpired: (expired) =>
            silenceReportWorker.enqueue(
              Effect.gen(function* () {
                const shell = yield* projectionSnapshotQuery
                  .getThreadShellById(thread.id)
                  .pipe(Effect.map(Option.getOrUndefined));

                const session = shell?.session;

                if (session == null || session.activeTurnId !== turnId) return;

                // The diagnosis, for the log: which provider went quiet and for how long. The
                // user gets the typed reason, which says what to do instead of who to blame.
                yield* Effect.logWarning("a silent turn outlived its provider's liveness window", {
                  threadId: thread.id,
                  turnId,
                  provider,
                  livenessWindowMs: livenessWindowMsFor(provider),
                  silentForMs: expired.silentForMs,
                  lastActivityAt: DateTime.formatIso(DateTime.makeUnsafe(expired.lastActivityAtMs)),
                });

                const expiredAt = DateTime.formatIso(yield* DateTime.now);

                yield* orchestrationEngine.dispatch({
                  type: "thread.session.set",
                  commandId: CommandId.make(
                    `silence-watchdog:expired:${thread.id}:${turnId}:${expiredAt}`,
                  ),
                  threadId: thread.id,
                  session: {
                    ...session,
                    status: "error",
                    activeTurnId: null,
                    lastError: TURN_WENT_SILENT_ERROR,
                    lastErrorCode: TURN_WENT_SILENT_REFUSAL,
                    updatedAt: expiredAt,
                  },
                  createdAt: expiredAt,
                });

                yield* Effect.sync(() => botInbox.resolve(incidentKey));
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("failed to settle an expired silent turn", {
                    threadId: thread.id,
                    turnId,
                    cause: Cause.pretty(cause),
                  }),
                ),
              ),
            ),
        },
      });

      silenceWatchdogs.set(providerTurnKey(thread.id, turnId), handle);
    });

  return {
    silenceWatchdogs,
    silenceWaitingRequests,
    silenceIncidentKey,
    stopSilenceWatchdog,
    stopAllSilenceWatchdogs,
    silenceReportWorker,
    resolveSilenceIncidents,
    startTurnSilenceWatchdog,
  };
});
