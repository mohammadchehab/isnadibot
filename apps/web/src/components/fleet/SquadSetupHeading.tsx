import { useI18n } from "../../i18n";

/**
 * The fleet's name sits mid-sentence in the heading, so it loses its capital:
 * "Set up your software engineering squad". A script without case is unchanged.
 */
function midSentence(name: string): string {
  return name.charAt(0).toLocaleLowerCase() + name.slice(1);
}

/**
 * Screen 2's heading names the fleet the person picked. The name is the slot, so
 * every template reads its own title instead of the recruiting one.
 */
export function SquadSetupHeading({ templateName }: { readonly templateName: string }) {
  const { t } = useI18n();
  const name = midSentence(t(templateName));

  return (
    <div className="space-y-1">
      {/* Balanced, so a name too long for one line at phone width splits into two
          even lines instead of leaving "squad" alone on the second. A no-op for
          the names that already fit on one line. */}
      <h1 className="text-xl font-semibold text-balance">
        {t("Set up your {template} squad", { template: name })}
      </h1>
      <p className="text-sm text-muted-foreground">
        {t(
          "Choose the boss. The boss answers every message by default and hands work to the other bots with @mentions.",
        )}
      </p>
    </div>
  );
}
