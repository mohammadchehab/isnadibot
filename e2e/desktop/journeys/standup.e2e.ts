import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { hireRecruiting } from "../support/hireRecruiting.ts";
import { launchDesktop, type DesktopSession } from "../support/launch.ts";

/**
 * E13 step 5 (#192): the space standup — capacity, queue and blockers in one block on the Overview.
 * Needs the Overview tab from #147 and the standup tile from #192, which are on the integration head.
 */
describe("E13 step 5: space standup", () => {
  let session: DesktopSession;
  let page: Page;

  beforeAll(async () => {
    session = await launchDesktop("standup");
    page = session.page;
    await hireRecruiting(session);
  }, 240_000);

  afterAll(async () => {
    await session?.close();
  });

  it("shows capacity, queue and blockers in one standup block", async () => {
    await page.getByRole("tab", { name: "Overview" }).click();

    const standup = page.getByText("Standup", { exact: true }).first();
    await standup.waitFor({ state: "visible", timeout: 15_000 });
    await session.shot("5-1-overview-standup");

    // A fresh squad is idle with an empty queue; the one block reports exactly that.
    expect(await page.getByText("Everyone is idle and the queue is empty.").count()).toBe(1);
  });
});
