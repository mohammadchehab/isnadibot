import { assert, it } from "@effect/vitest";

import { latestScheduledFor, nextScheduledFor } from "./schedule.ts";

it("keeps daily wall time across daylight saving changes", () => {
  assert.equal(
    nextScheduledFor(
      { kind: "daily", time: "09:00" },
      "America/New_York",
      Date.parse("2026-03-07T15:00:00.000Z"),
    ),
    "2026-03-08T13:00:00.000Z",
  );
});

it("finds the latest weekday slot for missed-run coalescing", () => {
  assert.equal(
    latestScheduledFor(
      { kind: "weekdays", time: "09:00" },
      "America/New_York",
      Date.parse("2026-08-31T20:00:00.000Z"),
    ),
    "2026-08-31T13:00:00.000Z",
  );
});

it("lands an interval routine on the next slot from local midnight", () => {
  // 16:00 in New York; the every-6-hours slots are 0, 6, 12 and 18.
  assert.equal(
    nextScheduledFor(
      { kind: "interval", everyHours: 6 },
      "America/New_York",
      Date.parse("2026-08-31T20:00:00.000Z"),
    ),
    "2026-08-31T22:00:00.000Z",
  );
});

it("coalesces a missed interval run onto its own last slot", () => {
  assert.equal(
    latestScheduledFor(
      { kind: "interval", everyHours: 6 },
      "America/New_York",
      Date.parse("2026-08-31T20:00:00.000Z"),
    ),
    "2026-08-31T16:00:00.000Z",
  );
});

it("rolls an hourly routine into the next local day", () => {
  // 23:30 in New York, so the next slot is midnight the following day.
  assert.equal(
    nextScheduledFor(
      { kind: "interval", everyHours: 1 },
      "America/New_York",
      Date.parse("2026-09-01T03:30:00.000Z"),
    ),
    "2026-09-01T04:00:00.000Z",
  );
});
