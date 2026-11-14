import type { Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { hireRecruiting } from "../support/hireRecruiting.ts";
import { launchDesktop, type DesktopSession } from "../support/launch.ts";

/**
 * E13 step 6 (#216, TASK-237/TASK-250): delete the space, then its bots.
 * Bug C is fixed on main: deleting the space's boss while the space exists is refused in plain
 * words, not with "Orchestration command invariant failed (bot.delete)" and raw ids.
 *
 * Asserted: no visible toast or dialog ever contains "invariant" or a raw UUID.
 */
const RAW_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

describe("E13 step 6: delete the space and its bots", () => {
  let session: DesktopSession;
  let page: Page;

  beforeAll(async () => {
    session = await launchDesktop("teardown");
    page = session.page;
    await hireRecruiting(session);
  }, 240_000);

  afterEach(async ({ task }) => {
    if (task.result?.state === "fail")
      await session.shot(`6-failed-${task.name.replace(/\W+/g, "-").slice(0, 40)}`);
  });

  afterAll(async () => {
    await session?.close();
  });

  /** Opens a bot's settings from its roster row menu. */
  async function openBotSettings(name: string) {
    await page
      .getByRole("button", { name: `Actions for ${name}`, exact: true })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Bot settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Delete", exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
  }

  /** Fails the step if any visible text carries the server's internal wording or a raw id. */
  async function expectNoRawFailure(where: string) {
    const text = await page.locator("body").innerText();
    expect(text, `raw wording after ${where}`).not.toMatch(/invariant/i);
    expect(text, `raw id after ${where}`).not.toMatch(RAW_ID);
  }

  it("refuses to delete the boss while the space exists, in plain words", async () => {
    await openBotSettings("Tracker");
    await page.getByRole("button", { name: "Delete", exact: true }).first().click();

    const dialog = page.getByRole("alertdialog").first();
    await dialog.waitFor({ state: "visible", timeout: 15_000 });
    expect(await dialog.innerText()).toContain("is the boss of Recruiting");
    await session.shot("6-1-boss-refusal-dialog");
    await expectNoRawFailure("boss refusal");

    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  it("deletes the space, then its bots, with no raw failure wording", async () => {
    await expectNoRawFailure("start of teardown");
    await page.getByRole("button", { name: "Recruiting", exact: true }).first().click();
    // Delete group is the space's own action, on its details sidebar.
    await page
      .getByRole("button", { name: /group sidebar/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Delete group", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete group" }).click();
    await page
      .getByRole("heading", { name: "Recruiting" })
      .first()
      .waitFor({ state: "detached", timeout: 30_000 })
      .catch(() => undefined);
    await session.shot("6-2-space-deleted");
    await expectNoRawFailure("space delete");

    for (const name of ["Tracker", "Scout", "Tailor", "Coach"]) {
      await openBotSettings(name);
      await page.getByRole("button", { name: "Delete", exact: true }).first().click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
      await page
        .getByRole("button", { name, exact: true })
        .first()
        .waitFor({ state: "detached", timeout: 30_000 });
      await expectNoRawFailure(`deleting ${name}`);
    }
    await session.shot("6-3-bots-deleted");
  });
});
