import type { ScopedThreadRef } from "@isnadi/contracts";
import { useEffect, useState } from "react";

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
import { Textarea } from "../ui/textarea";
import { useBotControlCommands } from "./useBotControls";

/** The bot a steer is open for, and the chat the correction goes to. */
export interface SteerTarget {
  readonly name: string;
  readonly ref: ScopedThreadRef;
}

/**
 * A correction for a turn that is already running, sent from the roster so the
 * user does not have to open the chat to say one sentence. It never stops the
 * turn — that is Interrupt's job — and the chat keeps the model and modes it is
 * running with.
 */
export function SteerBotDialog({
  target,
  onOpenChange,
}: {
  readonly target: SteerTarget | null;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { sendSteer } = useBotControlCommands();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  // Each open starts blank: the last correction is not the next one.
  useEffect(() => {
    if (target === null) return;
    setText("");
    setSending(false);
  }, [target]);

  const canSend = text.trim().length > 0 && !sending;

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      {target === null ? null : (
        <DialogPopup className="max-w-lg">
          <form
            onSubmit={(event) => {
              event.preventDefault();

              if (!canSend) return;
              setSending(true);
              void sendSteer(target.ref, text).then((sent) => {
                setSending(false);

                if (sent) onOpenChange(false);
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("Steer {name}", { name: target.name })}</DialogTitle>
              <DialogDescription>
                {t("{name} reads this before its next step. It doesn't stop the current card.", {
                  name: target.name,
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <Textarea
                autoFocus
                aria-label={t("Correction to {name}", { name: target.name })}
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
              />
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                {t("Cancel")}
              </Button>
              <Button type="submit" disabled={!canSend}>
                {t("Send to {name}", { name: target.name })}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      )}
    </Dialog>
  );
}
