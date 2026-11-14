import type { Page } from "playwright-core";
import { expect } from "vite-plus/test";

import type { DesktopSession } from "./launch.ts";

/**
 * E13 step 1 as a reusable setup: sidebar pencil > New space > Recruiting > Hire fleet >
 * squad setup > Create. Leaves the page on the new space, with its squad visible.
 * The "Tracker" boss is the Recruiting fleet's boss in the seeded template.
 */
export async function hireRecruiting(session: DesktopSession): Promise<void> {
  const page: Page = session.page;

  await page.locator('[data-testid="roster-new-bot"]:visible').first().click();
  await page.getByRole("menuitem", { name: "New space" }).click();
  await page
    .getByRole("heading", { name: "Start from a fleet" })
    .waitFor({ state: "visible", timeout: 30_000 });

  const card = page.locator('[data-template-id="recruiting"]:visible');
  await card.click();
  expect(await card.getAttribute("aria-pressed")).toBe("true");

  await page.getByRole("button", { name: "Hire fleet" }).click();
  await page.waitForURL(/\/spaces\/new\/recruiting/, { timeout: 15_000 });
  await page
    .getByText("Reply budget", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });

  await page.getByRole("main").getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL(/\/groups\//, { timeout: 60_000 });
  expect(await page.getByText("Could not create the space").count()).toBe(0);
  await page
    .getByText("Tracker", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
}
