import { describe, expect, it } from "vite-plus/test";

import {
  BOT_BODY,
  botArtInk,
  botAvatarArt,
  furryPath,
  type BotArtNode,
  type BotArtShape,
} from "./botAvatarArt.ts";

const SHAPES = Object.keys(BOT_BODY) as BotArtShape[];

describe("furryPath", () => {
  it("turns every body into one closed, deterministic furry outline", () => {
    for (const shape of SHAPES) {
      const fur = furryPath(BOT_BODY[shape], 1);

      expect(fur.startsWith("M")).toBe(true);
      expect(fur.endsWith("Z")).toBe(true);
      expect(fur).not.toContain("NaN");
      expect(fur.split("L").length).toBeGreaterThan(100);
      expect(furryPath(BOT_BODY[shape], 1)).toBe(fur);
    }
  });
});

describe("botAvatarArt", () => {
  it("draws a different face for each mood", () => {
    const faces = (["happy", "confused", "sad"] as const).map((mood) =>
      JSON.stringify(botAvatarArt("circle", "#2E8EFF", mood).face),
    );

    expect(new Set(faces).size).toBe(3);
  });

  it("droops the ears when sad", () => {
    const ears = (mood: "happy" | "sad") =>
      botAvatarArt("circle", "#2E8EFF", mood).back.map((node: BotArtNode) => node.attrs.transform);

    expect(ears("sad")).not.toEqual(ears("happy"));
  });

  it("keeps the ink readable on a near-black body", () => {
    expect(botArtInk("#2E8EFF")).toBe("#161616");
    expect(botArtInk("#000000")).toBe("#FFFFFF");
  });

  it("outlines only bodies light enough to fade into a light surface", () => {
    expect(botAvatarArt("drop", "#FFFFFF", "happy").outline).not.toBeNull();
    expect(botAvatarArt("drop", "#2E8EFF", "happy").outline).toBeNull();
  });
});
