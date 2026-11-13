import { useState } from "react";
import { readyMadeBot, type ReadyMadeBotId } from "@isnadi/contracts";
import {
  readyMadeBotCopy,
  readyMadeStartSchedule,
  readyMadeTargetProblem,
} from "@isnadi/client-runtime/fleet/ready-made-bot";
import type { RoutineAdapterSchedule } from "@isnadi/client-runtime/routines";

import { useI18n } from "../../i18n";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { ProviderUnavailableNotice } from "../chat/ProviderUnavailableNotice";

import { cn } from "../../lib/utils";
import { readFileAsDataUrl } from "../ChatView.logic";
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
import { AvatarColorPicker } from "./AvatarColorPicker";
import { BotAvatarView } from "./BotAvatarView";
import { ReadyMadeBotPicker } from "./ReadyMadeBotPicker";
import { RoutineScheduleFields } from "./RoutineScheduleFields";
import { BLOB_SHAPES, blobShapeLabel, randomBotAvatar } from "./roster.logic";
import type { BotAvatar } from "./types";
import { useBotEngineAvailability } from "./useBotEngineAvailability";
import type { NewBotInput } from "./useNewBotCreate";

const viewerTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** A compact bot creation form with all required choices in one view. */
export function NewBotDialog({
  open,
  onOpenChange,
  onCreate,
  /** Set while a create is in flight, so the form cannot be submitted twice. */
  submitting = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: NewBotInput) => void;
  submitting?: boolean;
}) {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  // A new bot answers with the app default. When no provider can run it, say so
  // here; the bot is still created and can reply once a provider connects.
  const defaultEngine = useBotEngineAvailability(null);
  const [name, setName] = useState("");
  const [blobAvatar, setBlobAvatar] = useState(() => randomBotAvatar());
  const [avatar, setAvatar] = useState<BotAvatar>(() => blobAvatar);
  const [presetId, setPresetId] = useState<ReadyMadeBotId | null>(null);
  const [target, setTarget] = useState("");
  const [schedule, setSchedule] = useState<RoutineAdapterSchedule>(() => ({
    frequency: "daily",
    time: "09:00",
    timezone: viewerTimezone(),
    weekday: null,
  }));
  const trimmedName = name.trim();
  const preset = presetId === null ? undefined : readyMadeBot(presetId);
  const presetCopy = preset ? readyMadeBotCopy(preset.id) : null;
  const targetProblem = preset ? readyMadeTargetProblem(target) : null;

  const selectPreset = (id: ReadyMadeBotId | null) => {
    setPresetId(id);
    const next = id === null ? undefined : readyMadeBot(id);

    if (!next) return;
    const copy = readyMadeBotCopy(next.id);
    // Name and look follow the preset only while the user has not set their own.
    setName((current) => (current.trim().length === 0 && copy ? t(copy.name) : current));

    // The look follows the preset only while the user has not uploaded their own.
    if (presetId === null) {
      if (next.avatar.kind === "blob") setBlobAvatar(next.avatar);
      setAvatar(next.avatar);
    }

    setTarget(next.defaultTarget);
    setSchedule(readyMadeStartSchedule(next, viewerTimezone()));
  };

  const updateBlobAvatar = (next: typeof blobAvatar) => {
    setBlobAvatar(next);
    setAvatar(next);
  };

  const handleUpload = (file: File | undefined) => {
    if (!file) return;
    void readFileAsDataUrl(file).then(
      (assetPath) => {
        setAvatar({ kind: "image", assetPath, dithered: false });
      },
      (cause: unknown) => {
        console.error("Could not read avatar image.", cause);
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        className="flex max-h-(--spacing-dvh-2rem) max-w-2xl flex-col overflow-hidden"
        bottomStickOnMobile={false}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();

            if (submitting || trimmedName.length === 0 || targetProblem !== null) return;
            onCreate({
              name: trimmedName,
              avatar,
              ...(preset
                ? { readyMade: { presetId: preset.id, target: target.trim(), schedule } }
                : {}),
            });
          }}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>{t("New bot")}</DialogTitle>
            <DialogDescription>
              {t("Give your teammate an identity. You can set its model and instructions next.")}
            </DialogDescription>
          </DialogHeader>

          <DialogPanel className="grid gap-6 sm:grid-cols-(--grid-template-columns-12rem-1fr)">
            <div className="sm:col-span-2">
              <ReadyMadeBotPicker
                selected={presetId}
                timezone={schedule.timezone}
                onSelect={selectPreset}
              />
            </div>
            {defaultEngine.blocked && defaultEngine.unavailability ? (
              <div className="sm:col-span-2">
                <ProviderUnavailableNotice
                  presentation={defaultEngine.unavailability}
                  provider={defaultEngine.unavailability.provider}
                  environmentId={environmentId}
                />
              </div>
            ) : null}
            <div className="flex flex-col items-center justify-center rounded-2xl border border-border/70 bg-secondary/35 px-4 py-7 text-center">
              <BotAvatarView avatar={avatar} name={trimmedName} className="size-20" />
              <div className="mt-4 max-w-full truncate text-sm font-semibold">
                {trimmedName || t("Your bot")}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {presetCopy ? t(presetCopy.role) : t("Preview")}
              </p>
            </div>

            <div className="min-w-0 space-y-6">
              <label className="flex flex-col gap-2 text-sm font-medium">
                {t("Bot name")}
                <Input
                  autoFocus
                  data-testid="new-bot-name-input"
                  maxLength={80}
                  placeholder={t("Name your bot")}
                  required
                  aria-describedby="new-bot-name-help"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <span
                  id="new-bot-name-help"
                  className={cn(
                    "text-xs font-normal",
                    trimmedName.length === 0 ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {trimmedName.length === 0
                    ? t("Enter a name to create this bot.")
                    : t("This is how the bot appears in your roster.")}
                </span>
              </label>

              {preset && presetCopy ? (
                <section
                  aria-labelledby="new-bot-ready-made-heading"
                  className="space-y-4 border-t border-border/70 pt-5"
                >
                  <h3
                    id="new-bot-ready-made-heading"
                    className="text-sm font-medium text-foreground"
                  >
                    {t(presetCopy.targetLabel)}
                  </h3>
                  <Input
                    data-testid="new-bot-target-input"
                    aria-invalid={targetProblem !== null}
                    aria-describedby="new-bot-target-help"
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                  />
                  <p
                    id="new-bot-target-help"
                    className={cn(
                      "text-xs",
                      targetProblem !== null ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {targetProblem === "unsupported-scheme"
                      ? t(presetCopy.targetSchemeProblem)
                      : targetProblem === "empty"
                        ? t(
                            "Enter a folder in the project, or a link that starts with http:// or https://.",
                          )
                        : t(presetCopy.targetHelp)}
                  </p>
                  <RoutineScheduleFields schedule={schedule} onChange={setSchedule} />
                </section>
              ) : null}

              <section
                aria-labelledby="new-bot-avatar-heading"
                className="space-y-4 border-t border-border/70 pt-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 id="new-bot-avatar-heading" className="text-sm font-medium text-foreground">
                    {t("Appearance")}
                  </h3>
                  <label className="cursor-pointer rounded-lg border border-border bg-secondary/60 px-3 py-1.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-secondary focus-within:ring-2 focus-within:ring-foreground/20">
                    {t("Upload image")}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(event) => handleUpload(event.currentTarget.files?.[0])}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {BLOB_SHAPES.map((shape) => {
                    const selected = avatar.kind === "blob" && blobAvatar.shape === shape;

                    return (
                      <Button
                        key={shape}
                        variant="avatar-tile"
                        size="avatar"
                        aria-label={blobShapeLabel(shape, t)}
                        aria-pressed={selected}
                        data-bot-hover
                        onClick={() => updateBlobAvatar({ ...blobAvatar, shape })}
                        className="aspect-square"
                      >
                        <BotAvatarView
                          avatar={{ ...blobAvatar, shape }}
                          name={trimmedName}
                          className="size-9"
                        />
                      </Button>
                    );
                  })}
                </div>

                <AvatarColorPicker
                  value={blobAvatar.color}
                  onChange={(color) => updateBlobAvatar({ ...blobAvatar, color })}
                />
              </section>
            </div>
          </DialogPanel>

          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              aria-describedby={trimmedName.length === 0 ? "new-bot-name-help" : undefined}
              variant="default-muted-disabled"
              disabled={submitting || trimmedName.length === 0 || targetProblem !== null}
            >
              {submitting ? t("Creating") : t("Create bot")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
