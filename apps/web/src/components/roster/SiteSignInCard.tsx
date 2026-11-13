import {
  cappedSiteSignInReason,
  deriveSiteSignInCard,
  type SiteSignInCardAction,
  type SiteSignInRequestRecord,
} from "@isnadi/client-runtime/browser-auth";
import { Button } from "~/components/ui/button";
import { useI18n } from "~/i18n";
import { cn } from "~/lib/utils";

import {
  BOT_COMPOSER_DOCKED_PANEL_CLASS_NAME,
  BOT_COMPOSER_QUIET_SURFACE_CLASS_NAME,
} from "./botConversationPresentation";

type Translate = ReturnType<typeof useI18n>["t"];

const actionLabel = (action: SiteSignInCardAction, t: Translate): string => {
  switch (action) {
    case "sign-in":
      return t("Sign in");
    case "sign-in-again":
      return t("Sign in again");
    case "not-now":
      return t("Not now");
    case "allow":
      return t("Allow");
    case "cancel":
      return t("Cancel");
    case "continue-sign-in":
      return t("Continue sign-in");
    case "keep-flow":
      return t("Keep the flow");
    case "save-again":
      return t("Save again");
    case "retry":
      return t("Retry");
  }
};

/** The failure the flow ended with, in the owner's words. Plain text, never a link. */
const failureText = (record: SiteSignInRequestRecord, t: Translate): string | null => {
  switch (record.failureClass) {
    case "in-use":
      return t("The site is in use by another sign-in.");
    case "signed-out-meanwhile":
      return t("This site was signed out while the form was open.");
    case "vault-disabled":
      return t("The saved password is locked in the vault.");
    case "signed-out":
      return t("This site was signed out.");
    case null:
      return null;
  }
};

/**
 * One card for every state of a sign-in request. The state comes from `deriveSiteSignInCard`, so
 * the card cannot drift into a second state machine; the buttons only send actions back.
 */
export function SiteSignInCard({
  record,
  botName,
  onAction,
  onOpenForm,
}: {
  readonly record: SiteSignInRequestRecord;
  readonly botName: string;
  readonly onAction: (action: SiteSignInCardAction) => void;
  readonly onOpenForm: () => void;
}) {
  const { t } = useI18n();
  const card = deriveSiteSignInCard(record);
  const failure = failureText(record, t);
  const reason = cappedSiteSignInReason(record.reason);

  const heading = (() => {
    switch (card.id) {
      case "asking":
        return t("Sign in to");
      case "asking-for-access":
        return t("Give {bot} access to", { bot: botName });
      case "signing-in":
        return t("Signing in to this site");
      case "finishing-sign-in":
        return t("Finishing sign-in…");
      case "signed-in":
        return record.kind === "access" ? t("Access allowed") : t("Signed in");
      case "not-signed-in-yet":
        return t("Not signed in yet");
      case "failed":
        return t("Sign-in didn't finish");
      case "failed-password-saved":
        return t("The saved password didn't work");
      case "expired":
        return t("This request expired");
      case "waiting-for-pc":
        return t("Waiting for your PC");
      case "not-now":
        return t("Not now");
    }
  })();

  const body = (() => {
    switch (card.id) {
      case "asking":
        return t("{bot} can't use this site until you sign in.", { bot: botName });
      case "asking-for-access":
        return t("{bot} is signed in to this site in another chat. Allow it here?", {
          bot: botName,
        });
      case "signing-in":
        return t("Finish the sign-in in the form, or press Continue sign-in.");
      case "finishing-sign-in":
        return t("The form was submitted. This can take a moment.");
      case "signed-in":
        return record.kind === "access"
          ? t("You gave {bot} access to this site.", { bot: botName })
          : t("{bot} can use this site in this chat.", { bot: botName });
      case "not-signed-in-yet":
        return t("The site did not confirm a signed-in session.");
      case "failed":
        return failure ?? t("The site did not sign in.");
      case "failed-password-saved":
        return t("The site did not accept the saved password.");
      case "expired":
        return t("{bot} is no longer waiting for this sign-in.", { bot: botName });
      case "waiting-for-pc":
        return t("The check to your PC did not answer in 5 seconds.");
      case "not-now":
        return t("{bot} can't use this site until you sign in.", { bot: botName });
    }
  })();

  return (
    <section
      aria-label={t("Site sign-in")}
      className={cn(BOT_COMPOSER_QUIET_SURFACE_CLASS_NAME, BOT_COMPOSER_DOCKED_PANEL_CLASS_NAME)}
      data-card={card.id}
      data-testid="site-sign-in-card"
    >
      <p
        className={cn(
          "text-xs font-medium",
          card.tone === "warning" ? "text-warning" : "text-muted-foreground",
        )}
      >
        {heading}
      </p>
      <p className="mt-1 truncate text-xl font-semibold text-foreground" dir="ltr">
        {record.site}
      </p>
      {reason ? <p className="mt-1 text-xs text-muted-foreground">{reason}</p> : null}
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
      {card.actions.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1.5">
          {card.actions.map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === card.primaryAction ? "default" : "ghost-muted"}
              presentation={action === card.primaryAction ? "approval-accept" : "approval-other"}
              onClick={() => {
                if (action === card.primaryAction && card.primaryOpensForm) {
                  onOpenForm();

                  return;
                }

                onAction(action);
              }}
            >
              {actionLabel(action, t)}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
