import { chromium } from "playwright-core";
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { chromiumLaunchOptions } from "./chromiumBinary.ts";

// The Hetzner runners provide the pinned Chromium, so this suite is the proof that a CI job can
// render a page on every one of them; TASK-35/36's browser tests drive the same binary. It skips
// on a host that provides none (a fork pull request's GitHub-hosted runner) instead of failing.
const launchOptions = chromiumLaunchOptions();

describe.runIf(launchOptions !== undefined)("host Chromium", () => {
  let server: NodeHttp.Server;
  let origin: string;

  beforeAll(async () => {
    server = NodeHttp.createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        "<!doctype html><title>Chromium smoke</title><main id='marker'>Chromium renders this page</main>",
      );
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    origin = `http://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("launches headless and renders a page", async () => {
    const browser = await chromium.launch(launchOptions);

    try {
      const page = await browser.newPage();
      await page.goto(origin);

      expect(await page.locator("#marker").innerText()).toBe("Chromium renders this page");
      expect(browser.version()).not.toBe("");
    } finally {
      await browser.close();
    }
  });
});
