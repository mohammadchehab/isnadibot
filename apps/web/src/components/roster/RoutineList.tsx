import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import {
  type RoutineAdapterBot,
  type RoutineAdapterDraft,
  type RoutineAdapterItem,
  type RoutineAdapterProject,
} from "@isnadi/client-runtime/routines";

import { useI18n } from "../../i18n";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { RoutineFormDialog, editDraft } from "./RoutineFormDialog";
import { RoutineCard, RoutineDetail, type RoutineActionProps } from "./RoutineCards";

export interface RoutineListProps extends RoutineActionProps {
  readonly status: "loading" | "ready" | "error" | "unavailable";
  readonly error?: string | null;
  readonly routines?: readonly RoutineAdapterItem[];
  readonly projectOptions?: readonly RoutineAdapterProject[];
  /**
   * Other bots a routine can hand its work to, resolved for the routine's own bot:
   * the owner is always offered first, and a bot that cannot take work is disabled.
   */
  readonly delegateOptionsOf?: (routine: RoutineAdapterItem) => readonly RoutineAdapterBot[];
  readonly busyRoutineId?: string | null;
  readonly onUpdate?: (routineId: string, draft: RoutineAdapterDraft) => void | Promise<void>;
  readonly onDelete?: (routineId: string) => void | Promise<void>;
  /** The bot a routine belongs to, for the card's schedule line and its edit dialog. */
  readonly botNameOf: (routine: RoutineAdapterItem) => string;
  /** True on a list that spans bots, where each card has to say whose routine it is. */
  readonly namesOwner?: boolean;
  /** What to show once the list has loaded and holds nothing. */
  readonly empty?: ReactNode;
  /** The heading and its create affordance, which give way to an opened routine. */
  readonly header?: ReactNode;
  /** What the loading line says. A page names what it is loading; a panel does not. */
  readonly loadingLabel?: string;
  /** A receipt that asks for the list back, closing whatever routine was open. */
  readonly listRequest?: number;
  /** Where focus goes when the list it would return to is empty. */
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

const EMPTY_ROUTINES: readonly RoutineAdapterItem[] = [];

const EMPTY_PROJECT_OPTIONS: readonly RoutineAdapterProject[] = [];

const EMPTY_DELEGATE_OPTIONS: readonly RoutineAdapterBot[] = [];

const NO_DELEGATES = () => EMPTY_DELEGATE_OPTIONS;

/**
 * The routine focus lands on once a deleted one is gone: the row that takes its
 * place in the list, else the row above it, else nothing — meaning the heading,
 * because the list it would have returned to is now empty.
 */
export function focusTargetAfterRoutineDelete(
  routineIds: readonly string[],
  deletedId: string,
): string | null {
  const index = routineIds.indexOf(deletedId);

  if (index === -1) return routineIds[0] ?? null;

  return routineIds[index + 1] ?? routineIds[index - 1] ?? null;
}

/**
 * The routine list and the one routine opened out of it: the same rows, the same
 * detail, and the same edit and delete dialogs whether the list is one bot's or
 * the whole environment's.
 */
export function RoutineList({
  status,
  error,
  routines = EMPTY_ROUTINES,
  projectOptions = EMPTY_PROJECT_OPTIONS,
  delegateOptionsOf = NO_DELEGATES,
  busyRoutineId = null,
  onUpdate,
  onDelete,
  botNameOf,
  namesOwner = false,
  empty = null,
  header = null,
  loadingLabel,
  listRequest = 0,
  returnFocusRef,
  ...actions
}: RoutineListProps) {
  const { t } = useI18n();
  const [editorRoutine, setEditorRoutine] = useState<RoutineAdapterItem | null>(null);
  const [deleteRoutine, setDeleteRoutine] = useState<RoutineAdapterItem | null>(null);
  const [deletingRoutineId, setDeletingRoutineId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const deleteBusyRef = useRef(false);
  const [deleteError, setDeleteError] = useState(false);
  const [openRoutineId, setOpenRoutineId] = useState<string | null>(null);
  // A list request (a receipt opening the routine list) lands on the heading,
  // not on the row of the routine it closed.
  const listRequested = useRef(false);
  useEffect(() => {
    if (listRequest === 0) return;
    setOpenRoutineId((current) => {
      if (current !== null) listRequested.current = true;

      return null;
    });
  }, [listRequest]);
  const openRoutine = routines.find((routine) => routine.id === openRoutineId) ?? null;

  // Opening a routine replaces the list under the pointer, so focus follows it
  // in and returns to the row you came from rather than to the top of the page.
  const listRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const previousOpenId = useRef<string | null>(null);
  // Deleting is the one close that cannot go back where it came from: the row is
  // on its way out of the projection. The delete names its survivor here, and
  // holds it past the close so the confirm dialog does not restore focus over it.
  const deletedFocusTarget = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (deletingRoutineId === null || routines.some((routine) => routine.id === deletingRoutineId))
      return;
    setOpenRoutineId(null);
    setDeletingRoutineId(null);
  }, [deletingRoutineId, routines]);
  useEffect(() => {
    if (openRoutineId !== null && previousOpenId.current === null) {
      detailRef.current?.querySelector<HTMLElement>("[data-routine-back]")?.focus();
    } else if (openRoutineId === null && previousOpenId.current !== null) {
      const target = listRequested.current
        ? null
        : deletedFocusTarget.current === undefined
          ? previousOpenId.current
          : deletedFocusTarget.current;

      listRequested.current = false;

      const rows =
        target === null
          ? []
          : (listRef.current?.querySelectorAll<HTMLElement>("[data-routine-row]") ?? []);

      let restored = false;

      for (const row of rows) {
        if (row.dataset.routineRow === target) {
          row.focus();
          restored = true;
          break;
        }
      }

      if (!restored) returnFocusRef?.current?.focus();
    }

    previousOpenId.current = openRoutineId;
  }, [openRoutineId, returnFocusRef]);

  // The environment cannot run routines, so there is nothing to show or act on.
  if (status === "unavailable") return null;

  // The heading gives way to the opened routine: the detail carries its own way back.
  const showsHeader = openRoutine === null && header != null;

  const body =
    status === "loading" ? (
      <p className="text-xs text-muted-foreground" aria-label={t("Loading routines")}>
        {loadingLabel ?? t("Loading")}
      </p>
    ) : status === "error" ? (
      <p className="text-xs text-destructive">{error || t("Could not load routines.")}</p>
    ) : openRoutine !== null ? (
      <div ref={detailRef}>
        <RoutineDetail
          routine={openRoutine}
          projectName={
            projectOptions.find((project) => project.id === openRoutine.projectId)?.name ??
            openRoutine.projectId
          }
          doneBy={
            openRoutine.delegateToBotId === null
              ? null
              : (delegateOptionsOf(openRoutine).find(
                  (bot) => bot.id === openRoutine.delegateToBotId,
                )?.name ?? t("Unknown bot"))
          }
          busy={busyRoutineId === openRoutine.id}
          onBack={() => setOpenRoutineId(null)}
          onEdit={() => setEditorRoutine(openRoutine)}
          onDeleteRequest={() => setDeleteRoutine(openRoutine)}
          {...(actions.onApproveProcedure
            ? { onApproveProcedure: actions.onApproveProcedure }
            : {})}
          {...(actions.onDryRun ? { onDryRun: actions.onDryRun } : {})}
          {...(actions.onRunNow ? { onRunNow: actions.onRunNow } : {})}
          {...(actions.onSetEnabled ? { onSetEnabled: actions.onSetEnabled } : {})}
          {...(actions.onSetPaused ? { onSetPaused: actions.onSetPaused } : {})}
        />
      </div>
    ) : routines.length === 0 ? (
      empty
    ) : (
      <div className="space-y-1.5" ref={listRef}>
        {routines.map((routine) => (
          <RoutineCard
            key={routine.id}
            routine={routine}
            ownerName={namesOwner ? botNameOf(routine) : null}
            busy={busyRoutineId === routine.id}
            onOpen={() => {
              deletedFocusTarget.current = undefined;
              setOpenRoutineId(routine.id);
            }}
            {...(actions.onSetEnabled ? { onSetEnabled: actions.onSetEnabled } : {})}
            {...(actions.onSetPaused ? { onSetPaused: actions.onSetPaused } : {})}
          />
        ))}
      </div>
    );

  return (
    <>
      {showsHeader ? header : null}
      <div className={showsHeader ? "mt-2" : undefined}>{body}</div>
      {editorRoutine ? (
        <RoutineFormDialog
          title="Edit routine"
          submitLabel="Save changes"
          initialDraft={editDraft(editorRoutine)}
          botName={botNameOf(editorRoutine)}
          projectOptions={projectOptions}
          delegateOptions={delegateOptionsOf(editorRoutine)}
          {...(onUpdate ? { onSubmit: (draft) => onUpdate(editorRoutine.id, draft) } : {})}
          onClose={() => setEditorRoutine(null)}
        />
      ) : null}
      <AlertDialog
        open={deleteRoutine !== null}
        onOpenChange={(open) => !open && !deleteBusyRef.current && setDeleteRoutine(null)}
      >
        <AlertDialogPopup
          // Cancelling belongs back on the Delete control it came from. Deleting does
          // not: that control and its routine are both leaving, so the list effect
          // places focus on the survivor and this must not move it afterwards.
          finalFocus={() => deletedFocusTarget.current === undefined}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Delete routine “{name}”?", { name: deleteRoutine?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("This removes the schedule and its run history.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" disabled={deleteBusy} />}>
              {t("Cancel")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={deleteBusy || !onDelete}
              onClick={() => {
                if (!deleteRoutine || !onDelete || deleteBusyRef.current) return;
                const id = deleteRoutine.id;
                deleteBusyRef.current = true;
                setDeleteBusy(true);
                setDeleteError(false);
                void Promise.resolve()
                  .then(() => onDelete(id))
                  .then(() => {
                    deletedFocusTarget.current = focusTargetAfterRoutineDelete(
                      routines.map((item) => item.id),
                      id,
                    );
                    setDeletingRoutineId(id);
                    setDeleteRoutine(null);
                  })
                  .catch(() => setDeleteError(true))
                  .finally(() => {
                    deleteBusyRef.current = false;
                    setDeleteBusy(false);
                  });
              }}
            >
              {deleteBusy ? t("Deleting…") : t("Delete")}
            </Button>
          </AlertDialogFooter>
          {deleteError ? (
            <p role="alert" className="text-sm text-destructive">
              {t("Could not delete routine")}. {t("Try again")}
            </p>
          ) : null}
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
