import { describe, expect, it } from "vite-plus/test";
import {
  isOpenTurn,
  isSilentTurn,
  isTerminalTurnState,
  isTurnEndingActivityKind,
  TERMINAL_TURN_STATES,
  TURN_ENDING_ACTIVITY_KINDS,
} from "./turnState.ts";
import { THREAD_SILENT_RUN_ACTIVITY_KIND } from "./thread.ts";

describe("the terminal turn states", () => {
  it("are the only states that are not running", () => {
    // Widened to string[] so the assertion can name "running", which the union excludes.
    const states: ReadonlyArray<string> = [...TERMINAL_TURN_STATES];
    expect(states.toSorted()).toEqual(["completed", "error", "interrupted"]);
    expect(states).not.toContain("running");
  });

  it("read as terminal and running does not", () => {
    for (const state of TERMINAL_TURN_STATES) expect(isTerminalTurnState(state)).toBe(true);
    expect(isTerminalTurnState("running")).toBe(false);
  });
});

describe("the activities that end a turn", () => {
  it("name the silence watchdog's report", () => {
    expect([...TURN_ENDING_ACTIVITY_KINDS]).toEqual([THREAD_SILENT_RUN_ACTIVITY_KIND]);
    expect(isTurnEndingActivityKind(THREAD_SILENT_RUN_ACTIVITY_KIND)).toBe(true);
  });

  it("do not name the watchdog's clear report or an ordinary activity", () => {
    expect(isTurnEndingActivityKind("turn.silent.cleared")).toBe(false);
    expect(isTurnEndingActivityKind("tool.progress")).toBe(false);
  });
});

describe("isOpenTurn", () => {
  const running = { state: "running" as const };

  it("is false for a chat with no turn yet", () => {
    expect(isOpenTurn(null)).toBe(false);
    expect(isOpenTurn(undefined)).toBe(false);
  });

  it("is true only while the turn runs and nothing ended it", () => {
    expect(isOpenTurn(running)).toBe(true);
    expect(isOpenTurn({ ...running, silentAt: null })).toBe(true);
  });

  it("is false for a silent turn, because the provider stopped answering", () => {
    expect(isOpenTurn({ ...running, silentAt: "2026-11-15T05:30:00.000Z" })).toBe(false);
    expect(isSilentTurn({ ...running, silentAt: "2026-11-15T05:30:00.000Z" })).toBe(true);
  });

  it("is true again once the provider speaks and clears the silence", () => {
    expect(isOpenTurn({ ...running, silentAt: null })).toBe(true);
    expect(isSilentTurn({ ...running, silentAt: null })).toBe(false);
  });

  it("is false for every terminal state, whatever the silence says", () => {
    for (const state of TERMINAL_TURN_STATES) {
      expect(isOpenTurn({ state })).toBe(false);
      expect(isOpenTurn({ state, silentAt: "2026-11-15T05:30:00.000Z" })).toBe(false);
    }
  });

  it("does not read a silent mark on a settled turn as a silent turn", () => {
    expect(isSilentTurn({ state: "completed", silentAt: "2026-11-15T05:30:00.000Z" })).toBe(false);
  });
});
