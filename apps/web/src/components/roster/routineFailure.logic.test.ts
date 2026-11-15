import * as Cause from "effect/Cause";
import { createTranslator } from "@isnadi/client-runtime/i18n";
import { describe, expect, it } from "vite-plus/test";

import { routineFailureToast } from "./routineFailure.logic";

const { translate } = createTranslator("en");

const failed = (error: Error | Record<string, string>) => ({ cause: Cause.fail(error) });

/** The refusal the decider throws when the routine moved on since the panel read it. */
const staleApproval = {
  _tag: "OrchestrationCommandInvariantError",
  message: "Routine 'rtn_7f3a' cannot approve procedure version 3; it is at version 4.",
  refusal: "stale-view",
};

describe("routineFailureToast", () => {
  it("shows the translated reason for a refusal this build has a code for", () => {
    const toast = routineFailureToast(
      failed(staleApproval),
      translate,
      "Could not approve procedure",
    );

    expect(toast.title).toBe("Could not approve procedure");
    expect(toast.description).toBe("Something here has changed. Refresh to see the latest.");
  });

  it("keeps the server's own sentence out of the toast", () => {
    const toast = routineFailureToast(
      failed(staleApproval),
      translate,
      "Could not approve procedure",
    );

    expect(JSON.stringify(toast)).not.toContain("rtn_7f3a");
    expect(JSON.stringify(toast)).not.toContain("version 4");
  });

  it("shows only the action label for a refusal this build has no code for", () => {
    const toast = routineFailureToast(
      failed(new Error("Routine 'rtn_7f3a' is deleted.")),
      translate,
      "Could not approve procedure",
    );

    expect(toast).toEqual({ title: "Could not approve procedure" });
  });

  it("shows only the action label for a failure with no message at all", () => {
    const toast = routineFailureToast(
      { cause: Cause.fail(undefined) },
      translate,
      "Could not save routine",
    );

    expect(toast).toEqual({ title: "Could not save routine" });
  });
});
