import { scopeThreadRef } from "@isnadi/client-runtime/environment";
import { FolderIcon } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";

import { useClientSettings } from "../../hooks/useSettings";
import { useI18n } from "../../i18n";
import { useThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useChatUnread } from "../chat/useChatUnread";
import { BotAvatarView } from "../roster/BotAvatarView";
import { formatRosterTimestamp } from "../roster/roster.logic";
import { useRosterStore } from "../roster/rosterStore";
import type { Bot } from "../roster/types";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Skeleton } from "../ui/skeleton";
import { botNameMap, buildChatRows, chatPreviewLine, type ChatRow } from "./chats.logic";

const SKELETON_ROWS = [0, 1, 2];

/** The page's one column: 45rem where there is room, else the viewport less a 1rem gutter. */
export const CHATS_COLUMN_CLASS = "mx-auto w-(--spacing-min-45rem-pct-2rem)";

/**
 * Every bot and space with a live conversation, newest first, as the frame
 * draws it: a 40px avatar or space tile, the owner's name, when the chat last
 * moved, and the last thing said in it.
 */
export function ChatsPage() {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const shells = useThreadShells();

  const { bots, groups } = useRosterStore(
    useShallow((state) => ({ bots: state.bots, groups: state.groups })),
  );

  const rows = useMemo(
    () => buildChatRows({ environmentId, shells, bots, groups }),
    [bots, environmentId, groups, shells],
  );

  const botNames = useMemo(() => botNameMap(bots), [bots]);
  const botById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot] as const)), [bots]);

  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle variant="body" className="text-sm">
            {t("No conversations yet")}
          </EmptyTitle>
          <EmptyDescription size="compact">
            {t("Start a chat with a bot and it will show up here.")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <ChatRowItem
          key={`${row.owner.kind}:${row.owner.id}`}
          row={row}
          bot={botById.get(row.owner.id) ?? null}
          botNames={botNames}
        />
      ))}
    </ul>
  );
}

/** The loading state: three rows of the frame's geometry, holding the text they will show. */
export function ChatsPageSkeleton() {
  return (
    <div className="flex flex-col" data-testid="chats-skeleton">
      {SKELETON_ROWS.map((index) => (
        <div key={index} className="flex h-13 items-center gap-3 px-3">
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-60 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChatRowItem({
  row,
  bot,
  botNames,
}: {
  readonly row: ChatRow;
  readonly bot: Bot | null;
  readonly botNames: ReadonlyMap<string, string>;
}) {
  const { t, formatDate } = useI18n();
  const navigate = useNavigate();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const unread = useChatUnread(scopeThreadRef(row.environmentId, row.threadId));
  const preview = chatPreviewLine(row.lastMessage, botNames, t("You"));

  return (
    <li>
      <Button
        variant="ghost-quiet"
        size="row-two-line"
        className="w-full"
        data-testid="chats-row"
        onClick={() =>
          void navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId: row.environmentId, threadId: row.threadId },
          })
        }
      >
        {row.owner.kind === "group" || bot === null ? (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FolderIcon className="size-4" />
          </span>
        ) : (
          <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-10" />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm leading-4.5 font-semibold">
              <bdi>{row.owner.name}</bdi>
            </span>
            <span className="min-w-2 flex-1" />
            <time
              dateTime={row.updatedAt}
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
            >
              {formatRosterTimestamp(row.updatedAt, timestampFormat, Date.now(), t, formatDate)}
            </time>
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span dir="auto" className="min-w-0 truncate text-sm text-muted-foreground">
              {preview === null || preview.speaker === null
                ? (preview?.text ?? null)
                : `${preview.speaker}: ${preview.text}`}
            </span>
            <span className="min-w-2 flex-1" />
            {unread ? (
              <span
                role="img"
                aria-label={t("Unread")}
                data-testid="chats-unread-dot"
                className="size-2 shrink-0 rounded-full bg-primary"
              />
            ) : null}
          </span>
        </span>
      </Button>
    </li>
  );
}
