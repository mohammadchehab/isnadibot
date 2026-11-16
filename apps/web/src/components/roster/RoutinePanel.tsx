import { useRef, useState } from "react";
import { PlusIcon } from "lucide-react";
import {
  type RoutineAdapterBot,
  type RoutineAdapterDraft,
  type RoutineAdapterItem,
  type RoutineAdapterProject,
} from "@isnadi/client-runtime/routines";

import { useI18n } from "../../i18n";
import { Button } from "../ui/button";
import { RoutineFormDialog, blankDraft } from "./RoutineFormDialog";
import { RoutineList, type RoutineListProps } from "./RoutineList";

export { RoutineDetail } from "./RoutineCards";

export { focusTargetAfterRoutineDelete, RoutineList } from "./RoutineList";

export { routineFormClosesOnOpenChange, showsWorkspacePicker } from "./RoutineFormDialog";

export { runStatusPresentation } from "./RoutineRunHistory";

export interface RoutinePanelProps extends Omit<
  RoutineListProps,
  "botNameOf" | "delegateOptionsOf" | "header" | "empty" | "namesOwner" | "loadingLabel"
> {
  readonly botName: string;
  /** Other bots this bot's routines can hand their work to. */
  readonly delegateOptions?: readonly RoutineAdapterBot[];
  readonly onCreate?: (draft: RoutineAdapterDraft) => void | Promise<void>;
  /** True when routines cannot be created yet because the bot's chat has not started. */
  readonly createNeedsChat?: boolean;
}

const EMPTY_ROUTINES: readonly RoutineAdapterItem[] = [];

const EMPTY_PROJECT_OPTIONS: readonly RoutineAdapterProject[] = [];

const EMPTY_DELEGATE_OPTIONS: readonly RoutineAdapterBot[] = [];

/** One bot's routines: its heading, the way to add one, and the list that heading opens. */
export function RoutinePanel({
  botName,
  status,
  routines = EMPTY_ROUTINES,
  projectOptions = EMPTY_PROJECT_OPTIONS,
  delegateOptions = EMPTY_DELEGATE_OPTIONS,
  onCreate,
  createNeedsChat = false,
  ...list
}: RoutinePanelProps) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  // The environment cannot run routines, so there is nothing to show or act on.
  if (status === "unavailable") return null;

  return (
    <section className="mt-6">
      <RoutineList
        {...list}
        status={status}
        routines={routines}
        projectOptions={projectOptions}
        delegateOptionsOf={() => delegateOptions}
        botNameOf={() => botName}
        returnFocusRef={headingRef}
        header={
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium" ref={headingRef} tabIndex={-1}>
              {t("Routines")}
            </h3>
            {onCreate && status === "ready" && routines.length > 0 ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("New routine")}
                onClick={() => setCreating(true)}
              >
                <PlusIcon aria-hidden />
              </Button>
            ) : null}
          </div>
        }
        empty={
          <>
            <p className="text-xs text-muted-foreground">
              {!onCreate && createNeedsChat
                ? t(
                    "Routines report to your chat with {botName}. Send {botName} a message to start the chat, then add a routine here.",
                    { botName },
                  )
                : t("None yet. Ask {botName} to create one.", { botName })}
            </p>
            {onCreate ? (
              // A quiet row, not a call to action: its label lines up with the
              // sheet's row labels and only the hover fill reaches past them.
              <Button
                variant="ghost-quiet"
                size="row"
                className="-mx-2 mt-1 w-(--spacing-full-plus-1rem) justify-start"
                onClick={() => setCreating(true)}
              >
                <PlusIcon aria-hidden />
                {t("New routine")}
              </Button>
            ) : null}
          </>
        }
      />
      {creating && onCreate ? (
        <RoutineFormDialog
          title="New routine"
          submitLabel="Create routine"
          initialDraft={blankDraft(projectOptions)}
          botName={botName}
          projectOptions={projectOptions}
          delegateOptions={delegateOptions}
          onSubmit={onCreate}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </section>
  );
}
