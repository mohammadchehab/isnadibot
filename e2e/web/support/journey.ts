import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { chromium, type Browser, type LaunchOptions, type Page } from "playwright-core";
import { afterEach, beforeEach } from "vite-plus/test";

import { reportFailure } from "./diagnostics.ts";
import type { Stack } from "./stack.ts";

/**
 * Launch options for the journeys' browser.
 *
 * An explicit `E2E_BROWSER_CHANNEL` wins, so a developer with a real Chrome keeps their setup.
 * Otherwise `ISNADI_CHROMIUM_PATH` — the pinned install CI exports (see docs/internals/ci.md) — is
 * launched by path, because a Hetzner runner has no system Chrome for `channel: "chrome"` to find
 * and the suite would die at launch, before the first assert. With neither set the old channel
 * default stands, so a Mac without the variable behaves exactly as before.
 *
 * The flags mirror `apps/server/src/browser/chromiumBinary.ts`, which is deliberately not imported:
 * `e2e/web` is its own package and borrowing from the server couples the harness to server
 * internals. `--no-sandbox` is required because Ubuntu 24.04's AppArmor restrictions on
 * unprivileged user namespaces make Chromium abort with "No usable sandbox"; `XDG_CONFIG_HOME`
 * keeps the crash database out of a `~/.config` the runner account cannot write, which otherwise
 * exits the browser with SIGTRAP.
 */
function browserLaunchOptions(): LaunchOptions {
  const channel = process.env.E2E_BROWSER_CHANNEL?.trim() ?? "";
  const executablePath = process.env.ISNADI_CHROMIUM_PATH?.trim() ?? "";
  const headless = process.env.E2E_HEADED !== "1";

  if (channel !== "") {
    return { channel, headless };
  }

  if (executablePath !== "") {
    return {
      executablePath,
      headless,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      env: {
        ...stringEnv(process.env),
        XDG_CONFIG_HOME: `${NodeOS.tmpdir()}/isnadi-e2e-chromium-${process.pid}`,
      },
    };
  }

  return { channel: "chrome", headless };
}

/** `process.env` without its undefined entries, which `LaunchOptions.env` does not accept. */
function stringEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/** Launches the journeys' browser: the pinned Chromium when CI exports one, else Chrome; headless unless `E2E_HEADED=1`. */
export function launchBrowser(): Promise<Browser> {
  return chromium.launch(browserLaunchOptions());
}

/**
 * Registers the hooks every journey shares; call it inside `describe`. A step stops at once if the server
 * restarted (its sessions are gone), and a failing step leaves a screenshot plus a report of where the
 * journey stood. `current` is read when a hook runs, after `beforeAll` has set the stack and page.
 */
export function journeyReport(
  current: () => { stack: Stack; page: Page; seen: () => ReadonlyArray<string> },
) {
  beforeEach(() => current().stack.assertNotRestarted());

  afterEach(async ({ task }) => {
    if (task.result?.state !== "fail") return;

    const { stack, page, seen } = current();

    const path = NodePath.join(
      process.env.E2E_ARTIFACTS_DIR ?? NodeOS.tmpdir(),
      `isnadi-e2e-${task.name.replace(/\W+/g, "-")}.png`,
    );

    // A crashed or closed page cannot be photographed; the report below is still the most useful part.
    try {
      await page.screenshot({ path });
      console.error(`Screenshot: ${path}`);
    } catch (error) {
      console.error(`No screenshot: ${error instanceof Error ? error.message : String(error)}`);
    }

    await reportFailure(page, stack, seen());
  });
}
