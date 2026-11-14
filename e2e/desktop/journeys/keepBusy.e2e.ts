import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { hireRecruiting } from "../support/hireRecruiting.ts";
import { launchDesktop, type DesktopSession } from "../support/launch.ts";

/**
 * E13 step 3: keep-busy dispatch. A queued item with no owner goes to an idle bot, which then
 * shows as working.
 *
 * Expected to fail until TASK-252 lands: no client sends group.keep-busy.set, so the space has
 * no keep-busy control. Role routing (TASK-86 AC4, #199) is not asserted here.
 */
describe("E13 step 3: keep-busy dispatch (expected to fail until TASK-252)", () => {
  let session: DesktopSession;
  let page: Page;

  beforeAll(async () => {
    session = await launchDesktop("keep-busy");
    page = session.page;
    await hireRecruiting(session);
  }, 240_000);

  afterAll(async () => {
    await session?.close();
  });

  it.fails("turns keep-busy on, dispatches a queued item to an idle bot, and shows it working", async () => {
    await page.getByRole("tab", { name: "Tasks" }).click();
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Keep-busy probe card");
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();

    await page.getByRole("button", { name: "Keep busy", exact: true }).click();
    await session.shot("3-1-keep-busy-on");

    await page.getByText("Keep-busy probe card", { exact: true }).first().waitFor({ state: "visible" });
    await page.getByText("In progress").first().waitFor({ state: "visible", timeout: 60_000 });
    expect(await page.getByText("Working", { exact: true }).count()).toBeGreaterThan(0);
    await session.shot("3-2-dispatched-working");
  });
});
