import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { BotAvatarView } from "./BotAvatarView";

describe("BotAvatarView", () => {
  it("draws a blob as a furry stitched body with a face", () => {
    const markup = renderToStaticMarkup(
      <BotAvatarView name="Theo" avatar={{ kind: "blob", shape: "hex", color: "#FF4A5A" }} />,
    );

    expect(markup).toContain('data-avatar-shape="hex"');
    expect(markup).toContain('data-bot-state="idle"');
    expect(markup).toContain('fill="#FF4A5A"');
    expect(markup).toMatch(/<radialGradient id="bot-[\w-]+-light"/);
    expect(markup).toMatch(/clip-path="url\(#bot-[\w-]+-clip\)"/);
    expect(markup).toContain('class="bot-eyes"');
    expect(markup).not.toContain("<canvas");
  });

  it("gives every avatar its own gradient and clip", () => {
    const avatar = { kind: "blob", shape: "circle", color: "#2E8EFF" } as const;

    const markup = renderToStaticMarkup(
      <>
        <BotAvatarView name="A" avatar={avatar} />
        <BotAvatarView name="B" avatar={avatar} />
      </>,
    );

    const ids = [...markup.matchAll(/<(?:radialGradient|clipPath) id="([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it("shows retired muted presets in the current palette", () => {
    const markup = renderToStaticMarkup(
      <BotAvatarView name="Old" avatar={{ kind: "blob", shape: "hex", color: "#E0645C" }} />,
    );

    expect(markup).toContain('fill="#FF4A5A"');
    expect(markup).not.toContain("#E0645C");
  });

  it("shows what the bot is doing on its face", () => {
    const avatar = { kind: "blob", shape: "square", color: "#5B7FD4" } as const;

    const face = (state: "idle" | "working" | "needs-you" | "blocked") => {
      const markup = renderToStaticMarkup(
        <BotAvatarView name="Isnadi" state={state} avatar={avatar} />,
      );

      expect(markup).toContain(`data-bot-state="${state}"`);

      return markup.slice(markup.indexOf('class="bot-eyes"'));
    };

    // Working and idle both grin; needs-you looks puzzled; blocked looks sad and cries.
    expect(face("working")).toEqual(face("idle"));
    expect(face("needs-you")).not.toEqual(face("idle"));
    expect(face("blocked")).toContain('fill="#7FD3FF"');
    expect(face("idle")).not.toContain('fill="#7FD3FF"');
  });

  it("outlines light bodies so they don't fade into a light surface", () => {
    const white = renderToStaticMarkup(
      <BotAvatarView name="Dew" avatar={{ kind: "blob", shape: "drop", color: "#FFFFFF" }} />,
    );

    const blue = renderToStaticMarkup(
      <BotAvatarView name="Rin" avatar={{ kind: "blob", shape: "drop", color: "#1FBFAE" }} />,
    );

    expect(white).toContain("rgba(0, 0, 0, 0.14)");
    expect(blue).not.toContain("rgba(0, 0, 0, 0.14)");
  });

  it("draws a legacy dither avatar as a blob", () => {
    const markup = renderToStaticMarkup(
      <BotAvatarView name="Isnadi" avatar={{ kind: "dither", seed: "isnadi-seed" }} />,
    );

    expect(markup).toContain("data-avatar-shape=");
    expect(markup).toContain('class="bot-eyes"');
  });
});
