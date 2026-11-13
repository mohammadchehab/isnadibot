import { BotIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { useI18n } from "../../i18n";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { NewBotDialog } from "./NewBotDialog";
import { useNewBotCreate, type NewBotInput } from "./useNewBotCreate";

/**
 * What a brand-new workspace sees. The old copy named the missing thing and
 * stopped there, leaving the only way forward in a menu on the other side of
 * the window. This says what a bot is for and creates one from here, using the
 * same command the roster's own New bot entry runs.
 */
export function BotZeroState() {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const { creating, createBot } = useNewBotCreate();
  const [open, setOpen] = useState(false);

  const handleCreate = async (input: NewBotInput) => {
    const botId = await createBot(input);

    if (botId === null) return;

    // The roster route watches for the new bot and opens its chat.
    setOpen(false);
  };

  return (
    <>
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
            <BotIcon className="size-5" />
          </div>
          <EmptyTitle>{t("Create your first bot")}</EmptyTitle>
          <EmptyDescription className="mt-2 leading-relaxed">
            {t(
              "A bot is a teammate you chat with. It keeps its own instructions, memory, tools, and schedule, so you can give it a job once and come back to it.",
            )}
          </EmptyDescription>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button
              disabled={environmentId === null || creating}
              size="sm"
              onClick={() => setOpen(true)}
            >
              <PlusIcon className="size-4" />
              {t("Create bot")}
            </Button>
            {environmentId === null ? (
              <span className="text-xs text-muted-foreground">
                {t("Connect an environment to create one.")}
              </span>
            ) : null}
          </div>
        </EmptyHeader>
      </Empty>
      {open ? (
        <NewBotDialog
          open
          submitting={creating}
          onOpenChange={(next) => {
            if (creating) return;
            setOpen(next);
          }}
          onCreate={(input) => void handleCreate(input)}
        />
      ) : null}
    </>
  );
}
