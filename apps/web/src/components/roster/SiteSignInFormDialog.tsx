import { useState } from "react";
import type { SiteSignInRequestRecord } from "@isnadi/client-runtime/browser-auth";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { useI18n } from "~/i18n";

export interface SiteSignInFormValues {
  readonly email: string;
  readonly password: string;
  readonly startUrl: string;
}

/**
 * The sign-in form (E3a): the owner types into Isnadi's own form and the server fills the site,
 * so the password never reaches a page a bot can see. Saving again skips the start URL, which is
 * fixed at the first sign-in.
 */
export function SiteSignInFormDialog({
  record,
  open,
  onOpenChange,
  onSubmit,
  onCancel,
}: {
  readonly record: SiteSignInRequestRecord;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (values: SiteSignInFormValues) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [startUrl, setStartUrl] = useState(record.startUrl ?? "");

  const savingAgain = record.checkFailed;
  const canSubmit = email.trim() !== "" && password !== "";

  // Whatever typed value the owner entered leaves this state when the form closes, however it
  // closes: Cancel, Save, Escape or the overlay. The password never outlives the form.
  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      setEmail("");
      setPassword("");
      setStartUrl(record.startUrl ?? "");
    }

    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {savingAgain
              ? t("Save again to {site}", { site: record.site })
              : t("Sign in to {site}", { site: record.site })}
          </DialogTitle>
          <DialogDescription>
            {t("IsnadiBot types these into the site for you. Nothing here is sent to a model.")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4 px-6 pb-5">
          {savingAgain ? (
            <p className="text-xs text-muted-foreground">
              {t("The site did not confirm a signed-in session. Save again to retry.")}
            </p>
          ) : null}
          <Field>
            <FieldLabel htmlFor="site-sign-in-email">{t("Email or username")}</FieldLabel>
            <Input
              id="site-sign-in-email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="site-sign-in-password">{t("Password")}</FieldLabel>
            <Input
              id="site-sign-in-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {savingAgain ? null : (
            <Field>
              <FieldLabel htmlFor="site-sign-in-start-url">{t("Sign-in page")}</FieldLabel>
              <Input
                id="site-sign-in-start-url"
                dir="ltr"
                value={startUrl}
                onChange={(event) => setStartUrl(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("Where the form opens. Leave it as the bot asked.")}
              </p>
            </Field>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="ghost-muted"
            onClick={() => {
              onCancel();
              close(false);
            }}
          >
            {t("Cancel")}
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              onSubmit({ email: email.trim(), password, startUrl: startUrl.trim() });
              close(false);
            }}
          >
            {t("Sign in")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
