import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { launchDesktop, type DesktopSession } from "../support/launch.ts";
import { hireRecruiting } from "../support/hireRecruiting.ts";

/**
 * E13 step 2 (#187): the space's Tasks board takes a work item.
 * Needs the #187 Tasks tab, so it runs on the integration head, not the bare #190 base.
 *
 * Not asserted here: a role on the item. The Tasks dialog has no role control on this head;
 * role routing (TASK-86 AC4) is still in draft #199.
 */
describe("E13 step 2: Tasks board work item", () => {
  let session: DesktopSession;
  let page: Page;

  beforeAll(async () => {
    session = await launchDesktop("tasks-board");
    page = session.page;
    await hireRecruiting(session);
  }, 240_000);

  afterAll(async () => {
    await session?.close();
  });

  it("adds a work item on the space's Tasks board", async () => {
    await page.getByRole("tab", { name: "Tasks" }).click();
    await page.getByTestId("space-tasks").waitFor({ state: "visible", timeout: 15_000 });
    await session.shot("2-1-tasks-board");

    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByText("Add a card", { exact: true })
      .waitFor({ state: "visible" });
    await page.getByLabel("Title", { exact: true }).fill("Draft the candidate outreach brief");
    await session.shot("2-2-add-card");

    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await page
      .getByText("Draft the candidate outreach brief", { exact: true })
      .waitFor({ state: "visible", timeout: 15_000 });
    expect(await page.getByText("Could not save the card").count()).toBe(0);
    await session.shot("2-3-card-on-board");
  });
});
