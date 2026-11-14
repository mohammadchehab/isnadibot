type Translate = (message: string) => string;

/** The words the keep-busy toggle shows, chosen once so its states cannot drift apart. */
export interface GroupKeepBusyCopy {
  readonly label: string;
  /** Says what on means and, in the same breath, what turning it off does not do. */
  readonly hint: string;
  readonly failureTitle: string;
}

/**
 * The toggle stops the fleet taking new items; it never cancels a turn already
 * running, so the hint says so rather than leaving the user to watch a turn
 * finish and conclude the switch did nothing.
 */
export function groupKeepBusyCopy(t: Translate): GroupKeepBusyCopy {
  return {
    label: t("Keep this group busy"),
    hint: t(
      "Bots here pick up new work as it arrives. Turn this off and they stop taking new items; work already in progress finishes.",
    ),
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
