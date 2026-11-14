import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const themeTokensCss = NodeFS.readFileSync(
  new URL("./styles/theme-tokens.css", import.meta.url),
  "utf8",
);

// The app sidebar's own token block: light declarations, then its nested dark variant.
const appSidebarBlock = themeTokensCss.match(/\[data-app-sidebar\] \{[\s\S]*?\n\}/)?.[0];

const [light = "", dark = ""] = appSidebarBlock?.split("@variant dark {") ?? [];

function tokenValue(block: string, token: string) {
  return block.match(new RegExp(`\\n\\s*--${token}:\\s*([^;]+);`))?.[1];
}

/**
 * The share of `--contrast-foreground` a row state paints over the sidebar. The dark row tokens
 * are all `color-mix(... N%, transparent)`, so N is what decides how visible the row is: the
 * sidebar's dark foreground is near-white, so a larger share is a lighter row.
 */
function mixShare(block: string, token: string): number {
  const value = tokenValue(block, token);
  const share = value?.match(/var\(--contrast-foreground\)\s*(\d+)%/)?.[1];

  if (share === undefined) {
    throw new Error(`--${token} is not a --contrast-foreground mix: ${String(value)}`);
  }

  return Number(share);
}

describe("app sidebar row tokens", () => {
  it("keeps the dark row ladder in the order a row is read: rest, hover, selected, active", () => {
    expect(appSidebarBlock).toBeDefined();

    const hover = mixShare(dark, "sidebar-row-hover");
    const selected = mixShare(dark, "sidebar-row-selected");
    const active = mixShare(dark, "sidebar-row-active");

    // Rest is the sidebar surface with no row overlay, so it sits below every row state.
    expect(hover).toBeGreaterThan(0);
    expect(hover).toBeLessThan(selected);
    expect(selected).toBeLessThanOrEqual(active);

    // The designer's 3-point ladder under --accent, pinned so a future edit cannot invert it again.
    expect([hover, selected, active]).toEqual([5, 8, 11]);
  });

  it("leaves the light row tokens as they were: zinc-25 hover, white selected and active", () => {
    expect(tokenValue(light, "sidebar-row-hover")).toBe("var(--color-zinc-25)");
    expect(tokenValue(light, "sidebar-row-selected")).toBe("var(--color-white)");
    // Active equalling selected is deliberate: pressing the row you are already on shows no change.
    expect(tokenValue(light, "sidebar-row-active")).toBe("var(--color-white)");
  });
});
