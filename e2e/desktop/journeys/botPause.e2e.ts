import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { hireRecruiting } from "../support/hireRecruiting.ts";
import { launchDesktop, type DesktopSession } from "../support/launch.ts";

/**
 * E13 step 4: a bot's status is visible, and a user can pause it (steer controls, #184/#182).
 *
 * Expected to fail until decision-81 is ruled and a pause control exists. The interrupt path
 * (Interrupt in the roster row menu) exists today and is not asserted here; that is option A.
 */
describe("E13 step 4: bot pause (expected to fail until decision-81)", () => {
  let session: DesktopSession;
  let page: Page;

  beforeAll(async () => {
    session = await launchDesktop("bot-pause");
    page = session.page;
    await hireRecruiting(session);
  }, 240_000);

  afterAll(async () => {
    await session?.close();
  });

  it.fails("pauses a bot from its roster row menu", async () => {
    await page.getByRole("button", { name: "Actions for Scout", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Pause", exact: true }).click();
    await session.shot("4-1-pause-menu");
    expect(await page.getByText("Paused", { exact: true }).count()).toBeGreaterThan(0);
  });
});
