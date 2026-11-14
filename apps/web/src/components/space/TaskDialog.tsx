import { BotId, type EnvironmentId, GroupId, type WorkItem, WorkItemId } from "@isnadi/contracts";
import { Predicate } from "effect";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { randomUUID } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { workItemEnvironment } from "../../state/workItems";
import type { Bot } from "../roster/types";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Field, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";

const TITLE_MAX_LENGTH = 200;

const BRIEF_MAX_LENGTH = 8000;

const NO_OWNER = "no-owner";

type TaskKind = WorkItem["kind"];

/** The dialog needs only the card's id; the brief comes from `workItems.get`. */
export type TaskDialogCard = { readonly id: WorkItemId };

/**
 * Adds a card to the board or edits one. A new card is created and then, if the
 * reader picked an owner, handed to that bot; an existing card's brief is read
 * first, because the shell carries only a preview of it.
 */
export function TaskDialog({
  environmentId,
  groupId,
  bots,
  card,
  open,
  onOpenChange,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly groupId: GroupId;
  readonly bots: ReadonlyArray<Bot>;
  readonly card: TaskDialogCard | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: () => void;
}) {
  const { t } = useI18n();

  const itemQuery = useEnvironmentQuery(
    card === null
      ? null
      : workItemEnvironment.item({ environmentId, input: { workItemId: card.id } }),
  );

  const cancel = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{card === null ? t("Add a card") : t("Edit card")}</DialogTitle>
        </DialogHeader>
        {card === null ? (
          <TaskForm
            key="new"
            environmentId={environmentId}
            groupId={groupId}
            bots={bots}
            item={null}
            onCancel={cancel}
            onSaved={onSaved}
          />
        ) : itemQuery.error !== null ? (
          <DialogPanel className="space-y-3 px-6 pb-5">
            <p role="alert" className="text-sm text-muted-foreground">
              {t("Could not load this card")}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={itemQuery.refresh}>
              {t("Try again")}
            </Button>
          </DialogPanel>
        ) : itemQuery.data === undefined ? (
          <DialogPanel className="px-6 pb-5">
            <p className="text-sm text-muted-foreground">{t("Loading…")}</p>
          </DialogPanel>
        ) : (
          <TaskForm
            key={card.id}
            environmentId={environmentId}
            groupId={groupId}
            bots={bots}
            item={itemQuery.data}
            onCancel={cancel}
            onSaved={onSaved}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

/**
 * The card's fields. A new card also picks its kind and its first owner; an
 * existing card edits its title, brief and owner, which are all the server's
 * `work-item.update` and `work-item.assign` can change.
 */
function TaskForm({
  environmentId,
  groupId,
  bots,
  item,
  onCancel,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly groupId: GroupId;
  readonly bots: ReadonlyArray<Bot>;
  readonly item: WorkItem | null;
  readonly onCancel: () => void;
  readonly onSaved: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(item?.title ?? "");
  const [brief, setBrief] = useState(item?.brief ?? "");
  const [kind, setKind] = useState<TaskKind>(item?.kind ?? "task");
  const [ownerBotId, setOwnerBotId] = useState<BotId | null>(item?.ownerBotId ?? null);
  const [busy, setBusy] = useState(false);

  const create = useAtomCommand(workItemEnvironment.create, { reportFailure: false });
  const assign = useAtomCommand(workItemEnvironment.assign, { reportFailure: false });
  const update = useAtomCommand(workItemEnvironment.update, { reportFailure: false });

  const trimmedTitle = title.trim();
  const canSave = trimmedTitle.length > 0 && !busy;

  const save = async () => {
    if (!canSave) return;

    setBusy(true);

    const workItemId = item?.id ?? WorkItemId.make(randomUUID());

    const written =
      item === null
        ? await create({
            environmentId,
            input: { workItemId, groupId, title: trimmedTitle, brief, kind },
          })
        : await update({ environmentId, input: { workItemId, title: trimmedTitle, brief } });

    if (Predicate.isTagged(written, "Failure")) {
      setBusy(false);
      toastManager.add({ type: "error", title: t("Could not save the card") });

      return;
    }

    if (ownerBotId !== (item?.ownerBotId ?? null)) {
      const assigned = await assign({ environmentId, input: { workItemId, ownerBotId } });

      if (Predicate.isTagged(assigned, "Failure")) {
        setBusy(false);
        toastManager.add({ type: "error", title: t("Could not save the owner") });

        return;
      }
    }

    setBusy(false);
    onSaved();
  };

  const ownerName = bots.find((bot) => bot.id === ownerBotId)?.name ?? t("No owner");

  return (
    <>
      <DialogPanel className="space-y-4 px-6 pb-5">
        <Field>
          <FieldLabel htmlFor="task-card-title">{t("Title")}</FieldLabel>
          <Input
            id="task-card-title"
            value={title}
            maxLength={TITLE_MAX_LENGTH}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="task-card-brief">{t("Brief")}</FieldLabel>
          <Textarea
            id="task-card-brief"
            value={brief}
            rows={5}
            maxLength={BRIEF_MAX_LENGTH}
            onChange={(event) => setBrief(event.target.value)}
          />
        </Field>
        {item === null ? (
          <Field>
            <FieldLabel htmlFor="task-card-kind">{t("Kind")}</FieldLabel>
            <Select
              value={kind}
              onValueChange={(value) => {
                if (value === "task" || value === "bug") setKind(value);
              }}
            >
              <SelectTrigger id="task-card-kind" className="w-full">
                <SelectValue>{kind === "bug" ? t("Bug") : t("Task")}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="task">{t("Task")}</SelectItem>
                <SelectItem value="bug">{t("Bug")}</SelectItem>
              </SelectPopup>
            </Select>
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor="task-card-owner">{t("Owner")}</FieldLabel>
          <Select
            value={ownerBotId ?? NO_OWNER}
            onValueChange={(value) =>
              setOwnerBotId(value === null || value === NO_OWNER ? null : BotId.make(value))
            }
          >
            <SelectTrigger id="task-card-owner" className="w-full">
              <SelectValue>{ownerName}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={NO_OWNER}>{t("No owner")}</SelectItem>
              {bots.map((bot) => (
                <SelectItem key={bot.id} value={bot.id}>
                  <bdi className="truncate">{bot.name}</bdi>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="ghost-muted" disabled={busy} onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button type="button" disabled={!canSave} onClick={() => void save()}>
          {busy ? t("Saving…") : t("Save")}
        </Button>
      </DialogFooter>
    </>
  );
}
