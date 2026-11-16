import {
  skillOriginSource,
  skillSizeLabel,
  useSkillRegistryActions,
  type RegistrySkill,
} from "@isnadi/client-runtime/skills";

import { useI18n } from "../../i18n";
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
import { SkillDialogLabel, SkillDialogNote } from "./SkillDialogBits";

/**
 * The second step of adding a Community skill: what the bot will be told, and every file that
 * arrives with it, before anything reaches a bot. Approving pins the commit it read (D28).
 *
 * It leads with the skill's provenance instead of the source picker, because the source is
 * settled by the time this opens.
 */
export function SkillApproveDialog({
  skill,
  onClose,
}: {
  readonly skill: RegistrySkill;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const actions = useSkillRegistryActions();
  const origin = skill.origin;
  const instructions = skill.instructions;
  const files = skill.files ?? [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{t("Add this skill?")}</DialogTitle>
          <DialogDescription>{t("Read what it does before a bot can use it.")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3.5">
            {origin === undefined ? null : (
              <div className="flex flex-col gap-0.5">
                <span className="text-11px leading-4 text-foreground">
                  {skillOriginSource(origin.url)}
                </span>
                <span className="text-11px leading-4 text-muted-foreground">
                  {t("Commit {commit} · {count} files · {size}", {
                    commit: origin.commit,
                    count: skill.fileCount,
                    size: skillSizeLabel(skill.sizeTokens),
                  })}
                </span>
              </div>
            )}
            {instructions === undefined ? null : (
              <>
                <SkillDialogLabel>{t("What the bot will be told")}</SkillDialogLabel>
                <div className="h-50 overflow-y-auto whitespace-pre-wrap text-12px leading-5 text-foreground">
                  {instructions}
                </div>
              </>
            )}
            {files.length === 0 ? null : (
              <>
                <SkillDialogLabel>{t("Files")}</SkillDialogLabel>
                {files.map((file) => (
                  <div key={file.path} className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-12px text-foreground">{file.path}</span>
                    <span className="shrink-0 text-11px leading-4 text-muted-foreground">
                      {skillSizeLabel(file.sizeTokens)}
                    </span>
                  </div>
                ))}
              </>
            )}
            <SkillDialogNote>
              {t(
                "Approving pins this commit. If the folder changes, Isnadi asks again before a bot uses it.",
              )}
            </SkillDialogNote>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={actions === null}
            onClick={() => {
              actions?.approveSkill(skill.id);
              onClose();
            }}
          >
            {t("Approve")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
