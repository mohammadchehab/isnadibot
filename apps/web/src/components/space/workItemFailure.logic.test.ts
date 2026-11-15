import * as NodeFS from "node:fs";

import { commandRefusalMessage } from "@isnadi/client-runtime/state/runtime";
import { CommandRefusalCodes } from "@isnadi/contracts";
import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { workItemFailureToast } from "./workItemFailure.logic";

/**
 * A translator that marks every key it sees, so a caller that forgets to pass
 * the UI's `t` shows up as English and fails the test rather than shipping.
 */
const arabicTranslate = (message: string) => `ar:${message}`;

/**
 * A refusal sentence the way the server writes it: the invariant's own prose, a
 * person id, and a group id. None of it may reach a person.
 */
const serverSentence = (code: string) =>
  `Orchestration command invariant failed (work-item.update): Person 'person-9f2a' is not a member of group 'group-7c1d'. [${code}]`;

/** An internal id or the invariant's vocabulary, which no copy may contain. */
const INTERNAL_PROSE = /person-9f2a|group-7c1d|invariant/i;

/**
 * The title each surface passes. The three paths are `SpaceTasks.tsx` (one
 * dispatch path) and `TaskDialog.tsx` (save and owner), which is why the titles
 * are listed rather than shared: they are the surface's own wording, and the
 * cases below hold the shared half — the sentence. That the surfaces really
 * pass these titles is asserted in "surface wiring", which reads their source.
 */
const SPACE_TASKS_TITLE = "Could not update the card";

const TASK_DIALOG_SAVE_TITLE = "Could not save the card";

const TASK_DIALOG_OWNER_TITLE = "Could not save the owner";

describe("workItemFailureToast", () => {
  // TASK-336: both surfaces toasted a title and dropped the reason, so a person
  // was told the card did not save and never why. These cases drive one coded
  // refusal through each surface's title and read the sentence back.
  it("says the catalog sentence for the state refusal on the Tasks board", () => {
    const toast = workItemFailureToast(
      { cause: Cause.fail({ refusal: "work-item-state-invalid" }), title: SPACE_TASKS_TITLE },
      arabicTranslate,
    );

    expect(toast).toEqual({
      type: "error",
      title: SPACE_TASKS_TITLE,
      description:
        "ar:That action does not fit this card's current state. Pick a different action.",
    });
  });

  it("says the catalog sentence for the open-limit refusal in the card dialog", () => {
    const toast = workItemFailureToast(
      { cause: Cause.fail({ refusal: "work-item-limit-reached" }), title: TASK_DIALOG_SAVE_TITLE },
      arabicTranslate,
    );

    expect(toast).toEqual({
      type: "error",
      title: TASK_DIALOG_SAVE_TITLE,
      description: "ar:This space already has as many open cards as it can hold. Close one first.",
    });
  });

  it("says the catalog sentence for the stale roster on the owner picker", () => {
    const toast = workItemFailureToast(
      {
        cause: Cause.fail({ refusal: "bot-not-a-group-member" }),
        title: TASK_DIALOG_OWNER_TITLE,
      },
      arabicTranslate,
    );

    expect(toast).toEqual({
      type: "error",
      title: TASK_DIALOG_OWNER_TITLE,
      description: "ar:That bot is no longer in this space. Refresh to see the current team.",
    });
  });

  it("keeps the title alone for a code this client does not know", () => {
    // The server's own sentence for an uncoded or unknown throw names whatever
    // ids it was given, so it must not be printed. A newer server's refusal
    // therefore says nothing here rather than leaking.
    const toast = workItemFailureToast(
      {
        cause: Cause.fail({ refusal: "work-item-moved-by-a-newer-server" }),
        title: SPACE_TASKS_TITLE,
      },
      arabicTranslate,
    );

    expect(toast).toEqual({ type: "error", title: SPACE_TASKS_TITLE });
  });

  it("keeps the title alone for a failure with no code at all", () => {
    const toast = workItemFailureToast(
      { cause: Cause.fail(new Error("Boom")), title: TASK_DIALOG_SAVE_TITLE },
      arabicTranslate,
    );

    expect(toast).toEqual({ type: "error", title: TASK_DIALOG_SAVE_TITLE });
  });

  it("never prints an id or the invariant prose, for any code, from any surface", () => {
    // A coded throw whose surface has no copy for that code leaks exactly like
    // an uncoded one, so the guarantee here is per code rather than per branch.
    for (const code of CommandRefusalCodes) {
      const message = serverSentence(code);

      for (const title of [SPACE_TASKS_TITLE, TASK_DIALOG_SAVE_TITLE, TASK_DIALOG_OWNER_TITLE]) {
        const toast = workItemFailureToast(
          { cause: Cause.fail({ refusal: code, message }), title },
          arabicTranslate,
        );

        expect(`${toast.title} ${toast.description ?? ""}`).not.toMatch(INTERNAL_PROSE);
      }
    }
  });

  it("has a shared sentence for every code, so no code falls through to the title", () => {
    for (const code of CommandRefusalCodes) {
      expect(commandRefusalMessage(code)).not.toBeNull();
    }
  });
});

/**
 * There is no DOM in this project to mount a surface into, so the wiring is
 * asserted at the source level, on both halves of the path — the precedent is
 * `BotZeroState.test.tsx`. The cases above prove the helper turns a code into a
 * sentence; they cannot see a surface that stops calling it, and that surface
 * would drop the reason again exactly as before this card. So each surface must
 * hand its failure to the helper with the title it owns, and must raise no
 * other toast of its own.
 */
describe("surface wiring", () => {
  const sourceOf = (file: string) => NodeFS.readFileSync(new URL(file, import.meta.url), "utf8");

  const SURFACES = [
    { file: "./SpaceTasks.tsx", titles: [SPACE_TASKS_TITLE] },
    { file: "./TaskDialog.tsx", titles: [TASK_DIALOG_SAVE_TITLE, TASK_DIALOG_OWNER_TITLE] },
  ] as const;

  for (const surface of SURFACES) {
    it(`routes every failure in ${surface.file} through the shared helper`, () => {
      const source = sourceOf(surface.file);

      // One toast per title the surface owns, so a fourth path added without a
      // title of its own fails here rather than silently showing a bare one.
      expect(source.match(/toastManager\.add\(/g) ?? []).toHaveLength(surface.titles.length);

      for (const title of surface.titles) {
        // The surface's own `t` call stays on the surface, so translation
        // coverage still discovers the string; only the sentence is shared.
        const call = new RegExp(
          `workItemFailureToast\\(\\{ cause: \\w+\\.cause, title: t\\("${title}"\\) \\}, t\\)`,
        );

        expect(source).toMatch(call);
      }
    });
  }

  it("keeps no title-only toast on either surface", () => {
    for (const surface of SURFACES) {
      // `toastManager.add({ title })` with no description is the shape this
      // card removed: it tells a person the card did not save and never why.
      expect(sourceOf(surface.file)).not.toMatch(/toastManager\.add\(\s*\{\s*title:/);
    }
  });
});
