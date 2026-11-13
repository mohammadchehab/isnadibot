import type { StandupBlockerOwner, StandupReport } from "@isnadi/client-runtime/space/standup";

import { useI18n } from "../../i18n";
import { cn } from "~/lib/utils";
import { BOT_STATUS_LABEL, BOT_STATUS_TONE } from "../roster/botStatusPresentation";
import { SpaceTile } from "./SpaceTile";

type Translate = ReturnType<typeof useI18n>["t"];

/**
 * Who a blocked card waits on. A card that names no blocker returns null and
 * shows only its note, which is what the reader needs anyway.
 */
function blockerLabel(t: Translate, owner: StandupBlockerOwner): string | null {
  switch (owner.kind) {
    case "user":
      return t("waiting on you");
    case "bot":
      return owner.name === null
        ? t("waiting on a bot")
        : t("waiting on {name}", { name: owner.name });
    case "unstated":
      return null;
  }
}

/**
 * The space's standup: who is on what, the cards next in the queue, and the ones
 * something has to move before they can go on. It is one short block, so it sits
 * above the dashboard's tiles rather than in one of them.
 */
export function SpaceStandup({ report }: { readonly report: StandupReport }) {
  const i18n = useI18n();
  const { t } = i18n;

  const working = report.capacity.rows.filter((row) => row.status !== "idle");
  const idle = report.capacity.rows.length - working.length;
  const moreQueued = report.queueTotal - report.queue.length;

  return (
    <SpaceTile title={t("Standup")}>
      {report.isQuiet ? (
        <p className="text-sm text-muted-foreground">
          {t("Everyone is idle and the queue is empty.")}
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3" data-testid="space-standup">
          {working.length > 0 ? (
            <ul className="flex flex-col">
              {working.map((row) => (
                <li
                  className="flex min-w-0 items-baseline gap-2 text-sm"
                  data-bot-id={row.botId}
                  data-status={row.status}
                  key={row.botId}
                >
                  <span className="shrink-0 font-medium text-foreground">
                    <bdi>{row.name}</bdi>
                  </span>
                  <span className={cn("shrink-0", BOT_STATUS_TONE[row.status])}>
                    {t(BOT_STATUS_LABEL[row.status])}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {row.item === null ? "—" : <bdi>{row.item.title}</bdi>}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {idle > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("{count} idle", { count: i18n.formatNumber(idle) })}
            </p>
          ) : null}
          {report.queueTotal > 0 ? (
            <section className="flex min-w-0 flex-col gap-1">
              <h4 className="text-xs font-medium text-muted-foreground">
                {t("Queued ({count})", { count: i18n.formatNumber(report.queueTotal) })}
              </h4>
              <ul className="flex flex-col">
                {report.queue.map((entry) => (
                  <li className="flex min-w-0 items-baseline gap-2 text-sm" key={entry.id}>
                    <span className="min-w-0 flex-1 truncate">
                      <bdi>{entry.title}</bdi>
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      <bdi>{entry.ownerName ?? t("unassigned")}</bdi>
                    </span>
                  </li>
                ))}
              </ul>
              {moreQueued > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("{count} more queued", { count: i18n.formatNumber(moreQueued) })}
                </p>
              ) : null}
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">{t("Nothing queued")}</p>
          )}
          {report.blocked.length > 0 ? (
            <section className="flex min-w-0 flex-col gap-1">
              <h4 className="text-xs font-medium text-muted-foreground">{t("Blocked")}</h4>
              <ul className="flex flex-col">
                {report.blocked.map((entry) => {
                  const waiting = blockerLabel(t, entry.owner);

                  return (
                    <li className="flex min-w-0 items-baseline gap-2 text-sm" key={entry.id}>
                      <span className="min-w-0 flex-1 truncate">
                        <bdi>{entry.title}</bdi>
                      </span>
                      {waiting === null ? null : (
                        <span className="shrink-0 text-muted-foreground">{waiting}</span>
                      )}
                      {entry.note === null ? null : (
                        <span className="min-w-0 shrink-0 truncate text-xs text-muted-foreground">
                          <bdi>{entry.note}</bdi>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">{t("Nothing blocked")}</p>
          )}
        </div>
      )}
    </SpaceTile>
  );
}
