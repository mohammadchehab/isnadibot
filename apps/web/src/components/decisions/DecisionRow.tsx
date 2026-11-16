import type { Decision } from "@isnadi/client-runtime/decisions";
import { UsersIcon } from "lucide-react";

import { useI18n } from "../../i18n";
import { BotAvatarView } from "../roster/BotAvatarView";
import type { DecisionOwner } from "./decisionOwner";

/**
 * One row of the Decisions page: who is waiting, what kind of prompt, and the
 * chat it waits in. The kind sits where a Chats row puts its timestamp, so it
 * keeps its place and shrinks to fit while the name and the title truncate.
 */
export function DecisionRow({
  decision,
  owner,
  onOpen,
}: {
  readonly decision: Decision;
  readonly owner: DecisionOwner;
  readonly onOpen: () => void;
}) {
  const { t } = useI18n();
  const kind = decision.kind === "approval" ? t("Approval needed") : t("Question");

  return (
    <button
      type="button"
      aria-label={`${kind}: ${owner.name} · ${decision.title}`}
      className="flex h-13 w-full shrink-0 cursor-pointer items-center gap-3 overflow-clip rounded-lg px-3 text-start outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onOpen}
    >
      {owner.avatar !== null ? (
        <BotAvatarView avatar={owner.avatar} name={owner.name} className="size-10 shrink-0" />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"
        >
          <UsersIcon className="size-4" />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <bdi className="truncate text-sm font-semibold text-foreground">{owner.name}</bdi>
          <span className="flex-1" />
          <span className="shrink-0 text-xs text-muted-foreground">{kind}</span>
        </span>
        <bdi className="block h-5 truncate text-sm text-muted-foreground">{decision.title}</bdi>
      </span>
    </button>
  );
}
