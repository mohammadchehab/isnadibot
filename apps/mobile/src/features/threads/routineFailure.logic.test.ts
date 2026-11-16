import * as Cause from "effect/Cause";
import { createTranslator } from "@isnadi/client-runtime/i18n";
import { describe, expect, it } from "vite-plus/test";

import { routineFailureMessage } from "./routineFailure.logic";

const { translate } = createTranslator("en");

const failed = (error: Error | Record<string, string>) => ({ cause: Cause.fail(error) });

/** The refusal the decider throws when the routine moved on since the screen read it. */
const staleApproval = {
  _tag: "OrchestrationCommandInvariantError",
  message: "Routine 'rtn_7f3a' cannot approve procedure version 3; it is at version 4.",
  refusal: "stale-view",
};

describe("routineFailureMessage", () => {
  it("shows the translated reason for a refusal this build has a code for", () => {
    expect(
      routineFailureMessage(failed(staleApproval), translate, "Could not approve procedure"),
    ).toBe("Something here has changed. Refresh to see the latest.");
  });

  it("keeps the server's own sentence out of the card", () => {
    const message = routineFailureMessage(
      failed(staleApproval),
      translate,
      "Could not approve procedure",
    );

    expect(message).not.toContain("rtn_7f3a");
    expect(message).not.toContain("version 4");
  });

  it("keeps the card's own copy for a refusal this build has no code for", () => {
    expect(
      routineFailureMessage(
        failed(new Error("Routine 'rtn_7f3a' is deleted.")),
        translate,
        "Could not approve procedure",
      ),
    ).toBe("Could not approve procedure");
  });

  it("keeps the card's own copy for a failure with no message at all", () => {
    expect(
      routineFailureMessage({ cause: Cause.fail(undefined) }, translate, "Could not save routine"),
    ).toBe("Could not save routine");
  });
});
