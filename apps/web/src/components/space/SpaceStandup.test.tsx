import { BotId } from "@isnadi/contracts";
import type {
  StandupBlocker,
  StandupQueueItem,
  StandupReport,
} from "@isnadi/client-runtime/space/standup";
import type { CapacityRow } from "@isnadi/client-runtime/fleet/capacity";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    locale: "en-GB",
    formatNumber: (value: number) => String(value),
    plural: (count: number, forms: { one: string; other: string }) =>
      (count === 1 ? forms.one : forms.other).replace("{count}", String(count)),
    t: (message: string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replaceAll(`{${key}}`, value),
        message,
      ),
  }),
}));

import { SpaceStandup } from "./SpaceStandup";

const row = (overrides: Partial<CapacityRow> & Pick<CapacityRow, "name">): CapacityRow => ({
  botId: BotId.make(overrides.name),
  name: overrides.name,
  isBoss: false,
  status: "idle",
  item: null,
  contextPercent: null,
  queued: 0,
  ...overrides,
});

const counts = (rows: ReadonlyArray<CapacityRow>) => ({
  asking: rows.filter((entry) => entry.status === "asking").length,
  held: rows.filter((entry) => entry.status === "held").length,
  busy: rows.filter((entry) => entry.status === "busy").length,
  idle: rows.filter((entry) => entry.status === "idle").length,
});

const queued = (id: string, ownerName: string | null = null): StandupQueueItem => ({
  id,
  title: `card ${id}`,
  ownerName,
});

const blockedBy = (
  id: string,
  owner: StandupBlocker["owner"],
  note: string | null = null,
): StandupBlocker => ({ id, title: `card ${id}`, owner, note });

const report = (overrides: Partial<StandupReport> = {}): StandupReport => {
  const rows = overrides.capacity?.rows ?? [row({ name: "Ada" })];

  return {
    capacity: { rows, counts: counts(rows) },
    queue: [],
    queueTotal: 0,
    blocked: [],
    isQuiet: false,
    ...overrides,
  };
};

const render = (input: StandupReport) => renderToStaticMarkup(<SpaceStandup report={input} />);

describe("SpaceStandup", () => {
  it("says so in one line when nothing is happening", () => {
    const html = render(report({ isQuiet: true }));

    expect(html).toContain("Everyone is idle and the queue is empty.");
    expect(html).not.toContain('data-testid="space-standup"');
  });

  it("shows who is on what, and counts the idle bots", () => {
    const html = render(
      report({
        capacity: {
          rows: [
            row({
              name: "Ada",
              status: "busy",
              item: { id: "w1", title: "Ship the board", extra: 0 },
            }),
            row({ name: "Grace", status: "idle" }),
          ],
          counts: { asking: 0, held: 0, busy: 1, idle: 1 },
        },
        isQuiet: false,
      }),
    );

    expect(html).toContain("<bdi>Ada</bdi>");
    expect(html).toContain("Busy");
    expect(html).toContain("Ship the board");
    expect(html).toContain("1 idle");
    // The idle bot gets a count, not a row.
    expect(html).not.toContain("<bdi>Grace</bdi>");
  });

  it("draws an em dash for a working bot that holds no card", () => {
    const html = render(
      report({
        capacity: {
          rows: [row({ name: "Ada", status: "asking" })],
          counts: { asking: 1, held: 0, busy: 0, idle: 0 },
        },
      }),
    );

    expect(html).toContain("Asking");
    expect(html).toContain("—");
  });

  it("caps the queue, counts the rest and totals the heading", () => {
    const html = render(
      report({
        queue: ["1", "2", "3", "4", "5"].map((id) => queued(id, "Ada")),
        queueTotal: 7,
        capacity: {
          rows: [
            row({ name: "Ada", status: "busy", item: { id: "w0", title: "Current", extra: 0 } }),
          ],
          counts: { asking: 0, held: 0, busy: 1, idle: 0 },
        },
      }),
    );

    expect(html).toContain("Queued (7)");
    expect(html.match(/card [1-5]/g)).toHaveLength(5);
    expect(html).not.toContain("card 6");
    expect(html).toContain("2 more queued");
  });

  it("marks a card nobody owns as unassigned", () => {
    expect(render(report({ queue: [queued("1")], queueTotal: 1 }))).toContain("unassigned");
  });

  it("names who each blocked card waits on", () => {
    const html = render(
      report({
        blocked: [
          blockedBy("1", { kind: "user" }, "Answer the question"),
          blockedBy("2", { kind: "bot", name: "Ada" }),
          blockedBy("3", { kind: "bot", name: null }),
        ],
      }),
    );

    expect(html).toContain("waiting on you");
    expect(html).toContain("waiting on Ada");
    expect(html).toContain("waiting on a bot");
    expect(html).toContain("Answer the question");
  });

  it("shows only the note when the card names no blocker", () => {
    const html = render(
      report({ blocked: [blockedBy("1", { kind: "unstated" }, "Blocked on CI")] }),
    );

    expect(html).toContain("Blocked on CI");
    expect(html).not.toContain("waiting on");
  });

  it("says when nothing is queued or blocked", () => {
    const html = render(
      report({
        capacity: {
          rows: [
            row({ name: "Ada", status: "busy", item: { id: "w1", title: "Current", extra: 0 } }),
          ],
          counts: { asking: 0, held: 0, busy: 1, idle: 0 },
        },
      }),
    );

    expect(html).toContain("Nothing queued");
    expect(html).toContain("Nothing blocked");
  });
});
