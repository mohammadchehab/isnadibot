type Translate = (message: string) => string;

/** The words the keep-busy toggle shows, chosen once so its states cannot drift apart. */
export interface GroupKeepBusyCopy {
  readonly label: string;
  /** What turning the switch on buys: the next card goes to whoever went idle. */
  readonly hint: string;
  /**
   * What turning it off leaves alone. Shown in both states rather than only
   * when off, so the promise that running cards finish is always in view.
   */
  readonly offHint: string;
  readonly failureTitle: string;
}

/**
 * The toggle stops the fleet taking new cards; it never cancels a card already
 * running, so the second line says so rather than leaving the user to watch a
 * card finish and conclude the switch did nothing.
 */
export function groupKeepBusyCopy(t: Translate): GroupKeepBusyCopy {
  return {
    label: t("Keep everyone busy"),
    hint: t("When a bot goes idle, it gets the next card. The boss is woken only to judge."),
    offHint: t("Turn it off and bots stop taking new cards; cards already running finish."),
    failureTitle: t("Could not change keep-busy for this group"),
  };
}

/**
 * The state the switch renders. A group the server never wrote the field for
 * has never been turned on, so absent reads as off.
 */
export function groupKeepsBusy(group: { readonly keepBusy?: boolean | undefined }): boolean {
  return group.keepBusy ?? false;
}
