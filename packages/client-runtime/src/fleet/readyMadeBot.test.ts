import {
  LINK_MONITOR_BOT_ID,
  LINK_MONITOR_LINK_BUDGET,
  READY_MADE_BOTS,
  readyMadeBot,
  type RoutineSchedule,
} from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  readyMadeBotCopy,
  readyMadeRoutineDraft,
  readyMadeStartSchedule,
  readyMadeTargetProblem,
} from "./readyMadeBot.ts";

const linkMonitor = () => {
  const bot = readyMadeBot(LINK_MONITOR_BOT_ID);

  if (!bot) throw new Error("the link monitor preset is missing from READY_MADE_BOTS");

  return bot;
};

describe("the ready-made roster", () => {
  it("holds the link monitor, and no id it does not hold", () => {
    expect(linkMonitor().id).toBe(LINK_MONITOR_BOT_ID);
    expect(readyMadeBot("no-such-preset")).toBeUndefined();
  });

  it("gives every preset the copy the picker needs to draw its row", () => {
    for (const bot of READY_MADE_BOTS) {
      const copy = readyMadeBotCopy(bot.id);

      expect(copy, `no copy for ${bot.id}`).not.toBeNull();
      expect(copy?.name).toBeTruthy();
      expect(copy?.role).toBeTruthy();
      expect(copy?.targetLabel).toBeTruthy();
      expect(copy?.targetHelp).toBeTruthy();
      expect(copy?.targetSchemeProblem).toBeTruthy();
    }
  });

  it("keeps the link monitor's procedure from passing a run that checked no links", () => {
    const { procedure } = linkMonitor();

    expect(procedure).toContain("found no docs to check");
    expect(procedure).toContain("Never report that no broken links were found");
  });
});

describe("readyMadeStartSchedule", () => {
  const botWith = (schedule: RoutineSchedule) => ({ ...linkMonitor(), schedule });

  it("keeps a daily schedule's time and the viewer's timezone", () => {
    expect(
      readyMadeStartSchedule(botWith({ kind: "daily", time: "09:00" }), "Europe/Amsterdam"),
    ).toEqual({
      frequency: "daily",
      time: "09:00",
      timezone: "Europe/Amsterdam",
      weekday: null,
    });
  });

  it("keeps a weekday schedule as weekdays", () => {
    expect(
      readyMadeStartSchedule(botWith({ kind: "weekdays", time: "08:30" }), "UTC"),
    ).toMatchObject({ frequency: "weekdays", time: "08:30", weekday: null });
  });

  it("shows a weekly schedule's first weekday as an index", () => {
    expect(
      readyMadeStartSchedule(
        botWith({ kind: "weekly", weekdays: ["wednesday"], time: "09:00" }),
        "UTC",
      ),
    ).toMatchObject({ frequency: "weekly", weekday: 3 });
  });
});

describe("readyMadeTargetProblem", () => {
  it("refuses an empty target", () => {
    expect(readyMadeTargetProblem("")).toBe("empty");
    expect(readyMadeTargetProblem("   ")).toBe("empty");
  });

  it("refuses a scheme the monitor cannot walk", () => {
    expect(readyMadeTargetProblem("ftp://example.com/docs")).toBe("unsupported-scheme");
    expect(readyMadeTargetProblem("mailto:hi@example.com")).toBe("unsupported-scheme");
  });

  it("accepts a repo path and an http(s) site", () => {
    expect(readyMadeTargetProblem("docs")).toBeNull();
    expect(readyMadeTargetProblem("docs/user")).toBeNull();
    expect(readyMadeTargetProblem("http://localhost:3000/docs")).toBeNull();
    expect(readyMadeTargetProblem("https://example.com/docs")).toBeNull();
  });
});

describe("readyMadeRoutineDraft", () => {
  const daily = { frequency: "daily", time: "09:00", timezone: "UTC", weekday: null } as const;

  it("spells out what the user typed and the link budget in the procedure", () => {
    const draft = readyMadeRoutineDraft(linkMonitor(), { target: "docs/user", schedule: daily });

    expect(draft.job).toBe(linkMonitor().job);
    expect(draft.procedure).toContain("Docs location: docs/user");
    expect(draft.procedure).toContain(`Link budget: ${LINK_MONITOR_LINK_BUDGET} links.`);
    expect(draft.procedure).toContain(linkMonitor().procedure);
  });

  it("trims the target so a stray space cannot break the path", () => {
    const draft = readyMadeRoutineDraft(linkMonitor(), {
      target: "  docs  ",
      schedule: daily,
    });

    expect(draft.procedure).toContain("Docs location: docs\n");
    expect(draft.procedure).not.toContain("Docs location:   docs");
  });

  it("turns the form's weekday index back into a named day", () => {
    const draft = readyMadeRoutineDraft(linkMonitor(), {
      target: "docs",
      schedule: { frequency: "weekly", time: "09:00", timezone: "UTC", weekday: 5 },
    });

    expect(draft.schedule).toEqual({ kind: "weekly", weekdays: ["friday"], time: "09:00" });
    expect(draft.timezone).toBe("UTC");
  });

  it("lands the same day on every weekday run it is asked for", () => {
    for (const weekday of [1, 2, 3, 4, 5]) {
      const draft = readyMadeRoutineDraft(linkMonitor(), {
        target: "docs",
        schedule: { frequency: "weekly", time: "09:00", timezone: "UTC", weekday },
      });

      expect(draft.schedule.kind).toBe("weekly");
    }
  });
});
