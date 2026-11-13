import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

vi.mock("expo-screen-capture", () => ({
  preventScreenCaptureAsync: vi.fn(async () => {}),
  allowScreenCaptureAsync: vi.fn(async () => {}),
}));

import { captureBlockFor } from "./useLiveViewCaptureBlock";

describe("captureBlockFor", () => {
  it("sets FLAG_SECURE only on Android, the platform that snapshots the recents thumbnail", () => {
    expect(captureBlockFor("android")).toBe("prevent");
  });

  it("leaves iOS and web alone, where the AppState cover is the whole protection", () => {
    expect(captureBlockFor("ios")).toBe("none");
    expect(captureBlockFor("web")).toBe("none");
  });
});
