import { describe, expect, it } from "vite-plus/test";

import {
  initialComputerViewerCover,
  reduceComputerViewerCover,
  shouldShowComputerFrame,
} from "./computerViewerCover.ts";

const apply = (events: Parameters<typeof reduceComputerViewerCover>[1][]) =>
  events.reduce(reduceComputerViewerCover, initialComputerViewerCover);

describe("computer viewer cover", () => {
  it("shows the frame while the app is active", () => {
    expect(shouldShowComputerFrame(initialComputerViewerCover)).toBe(true);
  });

  it("covers on inactive without ending the stream", () => {
    const next = apply([{ type: "app-state", status: "inactive", lastFrameAt: 10 }]);
    expect(next.covered).toBe(true);
    expect(next.streaming).toBe(true);
    expect(shouldShowComputerFrame(next)).toBe(false);
  });

  it("stops the stream on background", () => {
    const next = apply([{ type: "app-state", status: "background", lastFrameAt: 10 }]);
    expect(next.covered).toBe(true);
    expect(next.streaming).toBe(false);
  });

  it("keeps the cover after returning until a newer frame arrives", () => {
    const back = apply([
      { type: "app-state", status: "inactive", lastFrameAt: 10 },
      { type: "app-state", status: "active", lastFrameAt: 10 },
    ]);

    expect(shouldShowComputerFrame(back)).toBe(false);
    expect(
      shouldShowComputerFrame(reduceComputerViewerCover(back, { type: "frame", at: 10 })),
    ).toBe(false);
    expect(
      shouldShowComputerFrame(reduceComputerViewerCover(back, { type: "frame", at: 11 })),
    ).toBe(true);
  });

  it("ignores frames while the app is not active", () => {
    const covered = apply([{ type: "app-state", status: "inactive", lastFrameAt: 10 }]);
    expect(
      shouldShowComputerFrame(reduceComputerViewerCover(covered, { type: "frame", at: 99 })),
    ).toBe(false);
  });

  it("uncovers on the first frame when none existed before the cover", () => {
    const next = apply([
      { type: "app-state", status: "inactive", lastFrameAt: null },
      { type: "app-state", status: "active", lastFrameAt: null },
    ]);

    expect(next.covered).toBe(true);
    expect(shouldShowComputerFrame(reduceComputerViewerCover(next, { type: "frame", at: 1 }))).toBe(
      true,
    );
  });
});
