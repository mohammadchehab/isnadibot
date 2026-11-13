import { GroupId, type WorkItem, type WorkItemSummary } from "@isnadi/contracts";
import {
  WORK_ITEM_BOARD_COLUMNS,
  workItemActions,
  workItemBoard,
  type WorkItemColumn,
} from "@isnadi/client-runtime/space/work-items";
import { type AtomCommandResult } from "@isnadi/client-runtime/state/runtime";
import { MoreHorizontalIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Predicate } from "effect";

import { useI18n } from "../../i18n";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentSnapshot } from "../../state/environmentSnapshot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { workItemEnvironment } from "../../state/workItems";
import { BotAvatarView } from "../roster/BotAvatarView";
import { useRosterStore } from "../roster/rosterStore";
import type { Bot, Group } from "../roster/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { TaskDialog } from "./TaskDialog";

/** One card is an open summary from the shell or a finished item from the paged read. */
export type BoardCard = WorkItemSummary | WorkItem;

const FINISHED_PAGE_SIZE = 50;

const columnTitle = (column: WorkItemColumn, t: (message: string) => string): string => {
  switch (column) {
    case "new":
      return t("New");
    case "in-progress":
      return t("In progress");
    case "draft":
      return t("Draft");
    case "closed":
      return t("Closed");
    case "done":
      return t("Done");
  }
};

const columnEmptyCopy = (column: WorkItemColumn, t: (message: string) => string): string => {
  switch (column) {
    case "new":
      return t("No new cards");
    case "in-progress":
      return t("Nothing in progress");
    case "draft":
      return t("Nothing in draft");
    case "closed":
      return t("Nothing closed");
    case "done":
      return t("Nothing done");
  }
};

/**
 * The space's Tasks board: five columns in the epic's frame order, with the
 * cards a bot or a person owns and the moves the server decider allows.
 *
 * The shell carries open cards only, so Closed and Done page in through
 * `workItems.list` and read the first page each.
 */
export function SpaceTasks({ group }: { group: Group }) {
  const { t, formatNumber } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const snapshot = useEnvironmentSnapshot();
  const bots = useRosterStore((state) => state.bots);
  const [busyCardId, setBusyCardId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ readonly card: BoardCard | null } | null>(null);

  const groupId = GroupId.make(group.id);

  const doneQuery = useEnvironmentQuery(
    environmentId === null
      ? null
      : workItemEnvironment.finished({
          environmentId,
          input: { groupId, state: "done", limit: FINISHED_PAGE_SIZE },
        }),
  );

  const closedQuery = useEnvironmentQuery(
    environmentId === null
      ? null
      : workItemEnvironment.finished({
          environmentId,
          input: { groupId, state: "closed", limit: FINISHED_PAGE_SIZE },
        }),
  );

  const update = useAtomCommand(workItemEnvironment.update, { reportFailure: false });
  const close = useAtomCommand(workItemEnvironment.close, { reportFailure: false });
  const reopen = useAtomCommand(workItemEnvironment.reopen, { reportFailure: false });

  const openCards = useMemo(
    () => (snapshot?.workItems ?? []).filter((item) => item.groupId === group.id),
    [snapshot?.workItems, group.id],
  );

  const board = workItemBoard<BoardCard>([
    ...openCards,
    ...(doneQuery.data?.items ?? []),
    ...(closedQuery.data?.items ?? []),
  ]);

  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);

  const groupBots = useMemo(
    () =>
      group.members.flatMap((member) => {
        if (member.kind !== "bot") return [];

        const bot = botsById.get(member.botId);

        return bot ? [bot] : [];
      }),
    [group.members, botsById],
  );

  const boss = botsById.get(group.bossBotId ?? "");

  const refreshFinished = () => {
    doneQuery.refresh();
    closedQuery.refresh();
  };

  const run = async (
    card: BoardCard,
    command: () => Promise<AtomCommandResult<unknown, unknown>>,
  ) => {
    if (busyCardId !== null) return;

    setBusyCardId(card.id);

    const result = await command();

    setBusyCardId(null);

    if (Predicate.isTagged(result, "Failure")) {
      toastManager.add({ type: "error", title: t("Could not update the card") });

      return;
    }

    refreshFinished();
  };

  const moveCard = (card: BoardCard, state: "in-progress" | "review") => () =>
    void run(card, () => update({ environmentId, input: { workItemId: card.id, state } }));

  const closeCard = (card: BoardCard, resolution: "done" | "dropped") => () =>
    void run(card, () => close({ environmentId, input: { workItemId: card.id, resolution } }));

  const reopenCard = (card: BoardCard) => () =>
    void run(card, () => reopen({ environmentId, input: { workItemId: card.id } }));

  const finishedState = {
    closed: { query: closedQuery },
    done: { query: doneQuery },
  } as const;

  const renderFinishedNote = (column: "closed" | "done") => {
    const { query } = finishedState[column];

    if (query.isPending) {
      return <p className="px-1 text-xs text-muted-foreground">{t("Loading…")}</p>;
    }

    if (query.error) {
      return (
        <div className="flex flex-col gap-1 px-1">
          <p role="alert" className="text-xs text-muted-foreground">
            {t("Could not load these cards")}
          </p>
          <Button size="xs" variant="ghost" onClick={query.refresh}>
            {t("Try again")}
          </Button>
        </div>
      );
    }

    if (query.data && board[column].length > 0 && query.data.nextCursor !== undefined) {
      return (
        <p className="px-1 text-xs text-muted-foreground">
          {t("Showing the {count} most recent.", {
            count: formatNumber(board[column].length),
          })}
        </p>
      );
    }

    return null;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="space-tasks">
      <div className="flex items-start justify-between gap-3 p-4 pb-0">
        <p className="text-sm text-muted-foreground">
          {boss
            ? t("{name} assigns cards. They move when a bot finishes a step.", { name: boss.name })
            : t("Cards move when a bot finishes a step.")}
        </p>
        <Button
          size="xs"
          variant="outline"
          disabled={environmentId === null}
          onClick={() => setDialog({ card: null })}
        >
          {t("Add item")}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {WORK_ITEM_BOARD_COLUMNS.map((column) => {
          const cards = board[column];

          return (
            <section
              key={column}
              aria-label={columnTitle(column, t)}
              className="flex w-64 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2"
            >
              <h3 className="flex items-center justify-between gap-2 px-1 text-xs font-medium text-muted-foreground">
                <span>{columnTitle(column, t)}</span>
                <Badge size="sm" variant="quiet">
                  {formatNumber(cards.length)}
                </Badge>
              </h3>
              {cards.map((card) => (
                <TaskCard
                  key={card.id}
                  card={card}
                  owner={botsById.get(card.ownerBotId ?? "")}
                  assignedBy={botsById.get(card.assignedByBotId ?? "")}
                  busy={busyCardId === card.id}
                  onEdit={() => setDialog({ card })}
                  onStart={moveCard(card, "in-progress")}
                  onReview={moveCard(card, "review")}
                  onCloseDone={closeCard(card, "done")}
                  onCloseDropped={closeCard(card, "dropped")}
                  onReopen={reopenCard(card)}
                />
              ))}
              {cards.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{columnEmptyCopy(column, t)}</p>
              ) : null}
              {column === "closed" || column === "done" ? renderFinishedNote(column) : null}
            </section>
          );
        })}
      </div>
      {environmentId === null ? null : (
        <TaskDialog
          environmentId={environmentId}
          groupId={groupId}
          bots={groupBots}
          card={dialog?.card ?? null}
          open={dialog !== null}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onSaved={() => {
            setDialog(null);
            refreshFinished();
          }}
        />
      )}
    </div>
  );
}

function TaskCard({
  card,
  owner,
  assignedBy,
  busy,
  onEdit,
  onStart,
  onReview,
  onCloseDone,
  onCloseDropped,
  onReopen,
}: {
  readonly card: BoardCard;
  readonly owner: Bot | undefined;
  readonly assignedBy: Bot | undefined;
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onStart: () => void;
  readonly onReview: () => void;
  readonly onCloseDone: () => void;
  readonly onCloseDropped: () => void;
  readonly onReopen: () => void;
}) {
  const { t } = useI18n();
  const actions = workItemActions(card.state);
  const note = card.blockedOn?.note;

  return (
    <Card className="min-w-0 gap-2 p-3">
      <div className="flex items-start justify-between gap-1">
        <bdi className="min-w-0 text-sm font-medium">{card.title}</bdi>
        <Menu>
          <MenuTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="ghost-muted"
                aria-label={t("Card actions")}
                disabled={busy}
              >
                <MoreHorizontalIcon aria-hidden />
              </Button>
            }
          />
          <MenuPopup align="end" className="min-w-40">
            {actions.canStart ? <MenuItem onClick={onStart}>{t("Start")}</MenuItem> : null}
            {actions.canReview ? (
              <MenuItem onClick={onReview}>{t("Move to draft")}</MenuItem>
            ) : null}
            {actions.canEdit ? <MenuItem onClick={onEdit}>{t("Edit")}</MenuItem> : null}
            {actions.canClose ? <MenuSeparator /> : null}
            {actions.canClose ? (
              <MenuItem onClick={onCloseDone}>{t("Close as done")}</MenuItem>
            ) : null}
            {actions.canClose ? (
              <MenuItem variant="destructive" onClick={onCloseDropped}>
                {t("Close as dropped")}
              </MenuItem>
            ) : null}
            {actions.canReopen ? <MenuItem onClick={onReopen}>{t("Reopen")}</MenuItem> : null}
          </MenuPopup>
        </Menu>
      </div>
      {card.state === "blocked" ? (
        <Badge size="sm" variant="warning">
          <bdi className="truncate">{note ?? t("Blocked")}</bdi>
        </Badge>
      ) : null}
      {assignedBy ? (
        <span className="truncate text-xs text-muted-foreground">
          {t("Assigned by {name}", { name: assignedBy.name })}
        </span>
      ) : null}
      <div className="flex min-w-0 items-center gap-1.5">
        {owner ? (
          <>
            <BotAvatarView avatar={owner.avatar} name={owner.name} className="size-5" />
            <bdi className="truncate text-xs text-muted-foreground">{owner.name}</bdi>
          </>
        ) : (
          <span className="truncate text-xs text-muted-foreground">{t("No owner")}</span>
        )}
      </div>
    </Card>
  );
}
