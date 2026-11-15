import type { FleetHireBlocker } from "@isnadi/client-runtime/fleet/hire-plan";
import { TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription } from "../ui/alert";

/**
 * The refusals squad setup cannot get past from inside the screen. A missing or
 * duplicated name is fixed in the field that carries it, so it stays a footer
 * caption; these two are states of the client or the environment that stay
 * until something outside this screen changes, so the frame draws them as an
 * Alert band under the heading instead (frame 2f, no provider connected).
 */
export type SquadSetupHardBlock = "environment-rights" | "no-provider";

/**
 * The blocker the footer still names, once a hard block has its own band. A
 * squad can be hard-blocked and also need a name typed, and both are true, so
 * the band does not swallow the caption.
 */
export type SquadSetupCaptionBlocker = Exclude<FleetHireBlocker, { kind: "no-provider" }>;

/**
 * Which hard block, if any, the screen is under. The client's own rights come first: they refuse
 * every hire. A missing provider is looked for across every blocker, because the plan does not
 * order them: a member with no name typed and no provider connected reports `empty-name` first,
 * and that is the frame's state, so reading only the first blocker would draw no band at all.
 */
export function squadSetupHardBlock(
  readOnly: boolean,
  blockers: ReadonlyArray<FleetHireBlocker>,
): SquadSetupHardBlock | null {
  if (readOnly) return "environment-rights";

  return blockers.some((blocker) => blocker.kind === "no-provider") ? "no-provider" : null;
}

/** The first blocker that is still the footer's to name, once `no-provider` is drawn as the band. */
export function squadSetupCaptionBlocker(
  blockers: ReadonlyArray<FleetHireBlocker>,
): SquadSetupCaptionBlocker | undefined {
  return blockers.find(
    (candidate): candidate is SquadSetupCaptionBlocker => candidate.kind !== "no-provider",
  );
}

/**
 * A hard block, drawn the way the frame draws it: a full-width band under the
 * heading, read before the squad it blocks, with Create left in the footer.
 * Warning is the drawn variant and both blocks are the same kind of news, so
 * they share it. Neither has an action this screen can offer — re-pairing and
 * connecting a provider happen elsewhere — so the band carries none.
 */
export function SquadSetupHardBlockBand({ message }: { readonly message: string | null }) {
  if (message === null) return null;

  return (
    <Alert variant="warning" controlAlignment="first-line">
      <TriangleAlertIcon aria-hidden />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
