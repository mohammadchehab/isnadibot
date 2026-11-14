import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { launchDesktop, type DesktopSession } from "../support/launch.ts";

/**
 * E13 step 1 on the real desktop app: sidebar pencil > New space > Recruiting > Hire fleet >
 * squad setup renders > Create > lands in the new space.
 *
 * Known failures this journey pins (it must fail until they are fixed):
 *  - Bug A: Hire fleet does nothing. `_chat.spaces.new.tsx` has no <Outlet/>, so the
 *    `/spaces/new/$templateId` child (squad setup) never renders.
 *  - Bug B: after Create, a false "Could not create the space" toast though the hire succeeded.
 */
describe("E13 step 1: hire a fleet", () => {
  let session: DesktopSession;
  let page: Page;

  beforeAll(async () => {
    session = await launchDesktop("fleet-hire");
    page = session.page;
  }, 240_000);

  afterAll(async () => {
    await session?.close();
  });

  it("hires the Recruiting fleet from the sidebar and lands in the new space", async () => {
    // 1. Sidebar pencil > New space.
    await page.locator('[data-testid="roster-new-bot"]:visible').first().click();
    await page.getByRole("menuitem", { name: "New space" }).click();
    await page
      .getByRole("heading", { name: "Start from a fleet" })
      .waitFor({ state: "visible", timeout: 30_000 });
    await session.shot("1-1-start-from-a-fleet");

    // 2. Pick the Recruiting card.
    const card = page.locator('[data-template-id="recruiting"]:visible');
    await card.click();
    expect(await card.getAttribute("aria-pressed")).toBe("true");
    await session.shot("1-2-recruiting-selected");

    // 3. Hire fleet: squad setup must render (Bug A fails here).
    await page.getByRole("button", { name: "Hire fleet" }).click();
    await page.waitForURL(/\/spaces\/new\/recruiting/, { timeout: 15_000 });
    // "Reply budget" only exists on squad setup; the sidebar pencil is also named "Create".
    await page
      .getByText("Reply budget", { exact: true })
      .waitFor({ state: "visible", timeout: 15_000 });
    await session.shot("1-3-squad-setup");

    // 4. Create: lands in the new space with no false failure toast (Bug B fails here).
    await page.getByRole("main").getByRole("button", { name: "Create", exact: true }).click();
    await page.waitForURL(/\/groups\//, { timeout: 60_000 });
    expect(await page.getByText("Could not create the space").count()).toBe(0);
    // The hired squad must be in the space: the Recruiting boss is "Tracker".
    await page
      .getByText("Tracker", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await session.shot("1-4-space-created");
  });
});
