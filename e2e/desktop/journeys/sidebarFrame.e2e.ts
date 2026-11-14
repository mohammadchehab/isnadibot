import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { hireRecruiting } from "../support/hireRecruiting.ts";
import { launchDesktop, type DesktopSession } from "../support/launch.ts";

/**
 * Sidebar against Figma frame 2088:817 (TASK-255, file 4ifOkJwyqe2US4irHHsaiC).
 * The frame shows a "Spaces" section (Recruiting with a member-count badge) and a "Bots"
 * section that lists only bots outside a space. A hired squad must not appear as loose rows.
 *
 * Expected to fail until TASK-255 lands: the sidebar has no member count and lists the squad
 * under Bots. Nesting is out of scope until decision-75 is ruled; this asserts only the frame.
 */
const SQUAD = ["Tracker", "Scout", "Tailor", "Coach"];

describe("E13 sidebar frame 2088:817 (TASK-255)", () => {
  let session: DesktopSession;
  let page: Page;

  beforeAll(async () => {
    session = await launchDesktop("sidebar-frame");
    page = session.page;
    await hireRecruiting(session);
  }, 240_000);

  afterAll(async () => {
    await session?.close();
  });

  // Expected to fail until TASK-255 lands. Drop .fails when it passes.
  it.fails("shows the space under Spaces with its member count, and no loose squad rows under Bots", async () => {
    await page.getByText("Spaces", { exact: true }).first().waitFor({ state: "visible", timeout: 15_000 });
    await session.shot("sidebar-frame-1-spaces");

    const recruitingRow = page.locator("button:visible").filter({ hasText: "Recruiting" }).first();
    expect((await recruitingRow.innerText()).trim()).toMatch(/Recruiting\s*4$/);

    for (const bot of SQUAD) {
      expect(await page.locator("button:visible").filter({ hasText: new RegExp(`^${bot}$`) }).count()).toBe(0);
    }
  });
});
