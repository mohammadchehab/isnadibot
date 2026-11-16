import { useAtomValue } from "@effect/atom-react";
import { BotId, GroupId } from "@isnadi/contracts";
import { seedSquadMember } from "@isnadi/shared/fleet";
import * as Predicate from "effect/Predicate";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { randomUUID } from "../../lib/utils";
import { botEnvironment } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { primaryServerProvidersAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { DEFAULT_BOT_RUNTIME_MODE } from "../roster/botSandbox";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Radio, RadioGroup } from "../ui/radio-group";
import { toastManager } from "../ui/toast";
import { roleLibraryRows, roleModelLabel, suggestedBotName } from "./roleLibrary.logic";

/**
 * E13d: hire one bot into a space from the role library. The rows are the
 * engine's own roles (decision-118 A), so the dialog names no role the engine
 * cannot hire, and the bot it creates carries the role's avatar, skills and
 * default model — the same seed squad setup uses — instead of a bare name.
 */
export function RoleLibraryDialog({
  open,
  onOpenChange,
  space,
  takenNames,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly space: { readonly id: string; readonly name: string };
  /** The names the space already uses, so the suggested name does not collide. */
  readonly takenNames: ReadonlyArray<string>;
}) {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const createBot = useAtomCommand(botEnvironment.create, { reportFailure: false });
  const rows = roleLibraryRows();
  const [roleId, setRoleId] = useState<string>(() => rows[0]?.id ?? "");
  /** What the user typed; `null` while the field still follows the role's suggestion. */
  const [editedName, setEditedName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedRole = rows.find((role) => role.id === roleId) ?? rows[0];
  const roleName = selectedRole === undefined ? "" : t(selectedRole.name);
  // The frame rests with the suggestion filled in and Add live, so hiring a bot
  // costs one click: the field follows the role until the user types over it.
  const suggestedName = suggestedBotName(roleName, takenNames);
  const name = editedName ?? suggestedName;
  const trimmedName = name.trim();
  const canAdd = selectedRole !== undefined && trimmedName.length > 0 && !submitting;

  const handleOpenChange = (nextOpen: boolean) => {
    // Reopening starts from the suggestion again, whichever role is current then.
    if (!nextOpen) setEditedName(null);

    onOpenChange(nextOpen);
  };

  const handleAdd = async () => {
    if (selectedRole === undefined || trimmedName.length === 0 || environmentId === null) return;

    setSubmitting(true);

    try {
      const result = await createBot({
        environmentId,
        input: {
          botId: BotId.make(`bot-${randomUUID()}`),
          name: trimmedName,
          title: selectedRole.name,
          label: null,
          description: selectedRole.description,
          skills: selectedRole.skills.map((skillId) => ({ skillId, enabled: true })),
          avatar: selectedRole.avatar,
          engine: seedSquadMember(selectedRole, providers).engine,
          sandbox: null,
          runtimeMode: DEFAULT_BOT_RUNTIME_MODE,
          roleId: selectedRole.id,
          groupId: GroupId.make(space.id),
        },
      });

      if (Predicate.isTagged(result, "Failure")) {
        toastManager.add({ type: "error", title: t("Could not add the bot") });

        return;
      }

      handleOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup
        className="flex max-h-(--spacing-dvh-2rem) max-w-lg flex-col overflow-hidden"
        bottomStickOnMobile={false}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void handleAdd();
          }}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>{t("Add a bot to {name}", { name: space.name })}</DialogTitle>
            <DialogDescription>
              {t(
                "Pick a role. It comes with its instructions, skills and a default model you can change.",
              )}
            </DialogDescription>
          </DialogHeader>

          <DialogPanel className="grid gap-5">
            <RadioGroup value={roleId} onValueChange={setRoleId} className="gap-2">
              {rows.map((role) => (
                <label
                  key={role.id}
                  className="flex items-start gap-3 rounded-lg border border-border px-3.5 py-3 hover:bg-accent/50"
                >
                  <Radio value={role.id} className="mt-0.5" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium text-sm">{t(role.name)}</span>
                    <span className="text-muted-foreground text-xs">{t(role.description)}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {roleModelLabel(role, providers)}
                  </span>
                </label>
              ))}
            </RadioGroup>

            <div className="grid gap-2">
              <Label htmlFor="role-library-name">{t("Name")}</Label>
              <Input
                id="role-library-name"
                value={name}
                placeholder={suggestedName}
                onChange={(event) => setEditedName(event.target.value)}
              />
            </div>
          </DialogPanel>

          <DialogFooter className="shrink-0">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={!canAdd}>
              {selectedRole === undefined
                ? t("Add")
                : t("Add {role}", { role: t(selectedRole.name) })}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
