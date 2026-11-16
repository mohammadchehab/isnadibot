import type { IsnadiDelegationRecord, IsnadiDelegationState } from "@isnadi/contracts";
import { presentDelegation } from "@isnadi/client-runtime/delegation-presentation";
import { relativeRunTime } from "@isnadi/client-runtime/routines";

import { cn } from "~/lib/utils";

import { useI18n } from "../../i18n";
import { BotAvatarView } from "../roster/BotAvatarView";
import { delegationStateLabel } from "../roster/DelegationDetail";
import type { Bot } from "../roster/types";
import { Button } from "../ui/button";

/** The state word's ink. The word carries the state, not the row. */
const STATE_INK: Record<IsnadiDelegationState, string> = {
  queued: "text-muted-foreground",
  running: "text-muted-foreground",
  blocked: "text-warning",
  failed: "text-destructive",
  completed: "text-success",
  canceled: "text-muted-foreground",
};

/** The states that are waiting on the reader rather than working for them. */
function needsYou(state: IsnadiDelegationState): boolean {
  return state === "blocked" || state === "failed";
}

/** A needs-you row lifts off the tile on a warning surface; a resting one is plain. */
function frameClass(waiting: boolean): string {
  return cn("flex items-start gap-2.5", waiting ? "rounded-lg bg-warning-surface p-2.5" : "py-2.5");
}

/** Avatar 24 at rest, 28 with the state dot when the row is waiting on the reader. */
function RowAvatar({
  avatar,
  name,
  waiting,
  dotClass,
}: {
  readonly avatar: Bot["avatar"];
  readonly name: string;
  readonly waiting: boolean;
  readonly dotClass: string;
}) {
  return (
    <span className="relative shrink-0">
      <BotAvatarView avatar={avatar} name={name} className={waiting ? "size-7" : "size-6"} />
      {waiting ? (
        <span
          aria-hidden
          className={cn(
            "absolute -bottom-px -end-px size-1.5 rounded-full ring-1 ring-warning-surface",
            dotClass,
          )}
        />
      ) : null}
    </span>
  );
}

/** The state and the time under the copy, and Review at the end of the line when there is one. */
function MetaLine({
  ink,
  word,
  time,
  onReview,
}: {
  readonly ink: string;
  readonly word: string;
  readonly time: string;
  readonly onReview: (() => void) | null;
}) {
  const { t } = useI18n();

  return (
    <span className="mt-0.5 flex items-center gap-1.5 text-11px">
      <span className={ink}>{word}</span>
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <span className="text-muted-foreground">{time}</span>
      {onReview === null ? null : (
        <Button size="xs" variant="default" className="ms-auto" onClick={onReview}>
          {t("Review")}
        </Button>
      )}
    </span>
  );
}

/**
 * One delegation on the space's Activity tile. The row hugs its copy: the bot's name, what
 * happened in plain words, then the state word and the time. A blocked or failed row is the
 * one waiting on the reader, so it lifts off the tile and offers Review, which opens the child
 * chat; retry and cancel stay on the delegation's own card.
 */
export function SpaceActivityRow({
  delegation,
  bot,
  now,
  onReview,
}: {
  readonly delegation: IsnadiDelegationRecord;
  readonly bot: Bot | undefined;
  readonly now: number;
  readonly onReview: (() => void) | null;
}) {
  const i18n = useI18n();
  const { t } = i18n;

  const presentation = presentDelegation(delegation);
  const state = presentation.state;
  const name = bot?.name ?? t("Unknown bot");

  // What happened, when the record carries an outcome; otherwise the ask the bot was given.
  const sentence = presentation.outcome?.text.trim() || delegation.task;
  const stateWord = state === "blocked" ? t("Waiting on you") : delegationStateLabel(state, t);

  return (
    <li className={frameClass(needsYou(state))} data-delegation-state={state}>
      <RowAvatar
        avatar={bot?.avatar ?? { kind: "dither", seed: delegation.childBotId }}
        name={name}
        waiting={needsYou(state)}
        dotClass={state === "failed" ? "bg-destructive" : "bg-warning"}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <bdi className="truncate text-xs font-medium">{name}</bdi>
        <bdi className="text-xs">{sentence}</bdi>
        {/* Only the row waiting on the reader carries an action; finished and live work is
            reached through the delegation's own card. */}
        <MetaLine
          ink={STATE_INK[state]}
          word={stateWord}
          time={relativeRunTime(delegation.updatedAt, now, i18n)}
          onReview={needsYou(state) ? onReview : null}
        />
      </div>
    </li>
  );
}

/**
 * One chat on the same tile, in the same rhythm as a delegation row. A chat with a decision
 * waiting on the reader takes the needs-you frame and says so; a resting one carries only the
 * time. The title is the one line that truncates, because it is the reader's own words.
 */
export function SpaceChatActivityRow({
  title,
  bot,
  updatedAt,
  now,
  decision,
  onReview,
}: {
  readonly title: string;
  readonly bot: Bot | undefined;
  readonly updatedAt: string;
  readonly now: number;
  readonly decision: boolean;
  readonly onReview: (() => void) | null;
}) {
  const i18n = useI18n();
  const { t } = i18n;

  const name = bot?.name ?? t("Unknown bot");
  const time = relativeRunTime(updatedAt, now, i18n);

  return (
    <li className={frameClass(decision)} data-chat-waiting={decision || undefined}>
      <RowAvatar
        avatar={bot?.avatar ?? { kind: "dither", seed: title }}
        name={name}
        waiting={decision}
        dotClass="bg-warning"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <bdi className="truncate text-xs font-medium">{name}</bdi>
        <bdi className="truncate text-xs">{title}</bdi>
        {decision ? (
          <MetaLine ink="text-warning" word={t("Waiting on you")} time={time} onReview={onReview} />
        ) : (
          <span className="mt-0.5 text-11px text-muted-foreground">{time}</span>
        )}
      </div>
    </li>
  );
}
