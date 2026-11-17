import { ARCHIVED_BOT_RETENTION_DAYS, BotId, type EnvironmentId } from "@isnadi/contracts";
import { Predicate } from "effect";

import { useI18n } from "../../i18n";
import { botEnvironment } from "../../state/bots";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { botArchiveFailureToast, classifyBotArchiveFailure } from "../roster/botArchive.logic";

/** The row whose archive is being confirmed. */
export interface TeamArchiveTarget {
  readonly botId: string;
  readonly name: string;
  /** The space this bot leads, when it leads one; the boss refusal names it. */
  readonly bossSpaceName: string | null;
}

/**
 * The confirm behind a team row's `Archive {name}…` (E13b `2546:3758`). It is the
 * same confirm the roster row opens, with the same copy: archiving is reversible
 * from Settings > Archived, so the sentence says how long the way back lasts.
 *
 * One instance serves the whole table, so the dialog is not rebuilt per row.
 */
export function TeamArchiveDialog({
  target,
  environmentId,
  onOpenChange,
}: {
  readonly target: TeamArchiveTarget | null;
  readonly environmentId: EnvironmentId | null;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const archiveBotCommand = useAtomCommand(botEnvironment.archive, { reportFailure: false });

  const archive = async (row: TeamArchiveTarget) => {
    onOpenChange(false);

    if (environmentId === null) {
      toastManager.add({ type: "error", title: t("Connect an environment first") });

      return;
    }

    const result = await archiveBotCommand({
      environmentId,
      input: { botId: BotId.make(row.botId) },
    });

    if (!Predicate.isTagged(result, "Failure")) return;

    // A refusal names why, in the words the code alone chooses: the invariant
    // sentence carries ids a team row never shows.
    const copy = botArchiveFailureToast(
      {
        refusal: classifyBotArchiveFailure(result),
        botName: row.name,
        bossSpaceName: row.bossSpaceName,
      },
      t,
    );

    toastManager.add({ type: "error", title: copy.title, description: copy.description });
  };

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
    >
      {target === null ? null : (
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Archive {name}?", { name: target.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "{name} leaves the roster and stops taking messages. You can restore it from Settings > Archived for {days} days, then it is deleted. Its chats stay in your history.",
                { name: target.name, days: ARCHIVED_BOT_RETENTION_DAYS },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>{t("Cancel")}</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                void archive(target);
              }}
            >
              {t("Archive")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      )}
    </AlertDialog>
  );
}
