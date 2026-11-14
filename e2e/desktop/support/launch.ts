import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";

import {
  createSmokeEnvironment,
  resolveSmokeElectronPath,
} from "../../../apps/desktop/scripts/smoke-test.mjs";
import { startStubOpenAI, STUB_MODEL, type StubOpenAI } from "../../web/support/stubOpenAI.ts";

const DESKTOP_DIR = NodeURL.fileURLToPath(new URL("../../../apps/desktop", import.meta.url));
const ARTIFACTS_DIR = NodePath.resolve(
  NodeURL.fileURLToPath(new URL("..", import.meta.url)),
  "artifacts",
);

export const STUB_INSTANCE_ID = "custom_openai_e2e";

/** apps/web/src/components/onboarding/desktopOnboardingDraft.ts */
const ONBOARDING_COMPLETED_KEY = "isnadi:desktop-onboarding-completed:v1";

export interface DesktopSession {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly stub: StubOpenAI;
  /** The throwaway root that holds the app's home, OS profile and temp directories. */
  readonly root: string;
  /** Saves a full-window screenshot named after a step; returns its absolute path. */
  readonly shot: (name: string) => Promise<string>;
  readonly close: () => Promise<void>;
}

/**
 * Launches the built desktop app (apps/desktop, `dist-electron/main.cjs`) on an isolated home.
 * Every path the app writes to is inside a fresh temp root, so `~/.isnadi` is never touched.
 * The stub provider is preconfigured in the isolated home's settings, so bots can be hired
 * without a model sign-in.
 */
export async function launchDesktop(name: string): Promise<DesktopSession> {
  const stub = await startStubOpenAI();
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "isnadi-e2e-desktop-"));
  const env = createSmokeEnvironment(root, process.env);
  const isnadiHome = NodePath.join(root, "isnadi");

  for (const directory of [
    env.HOME,
    env.TMPDIR,
    env.APPDATA,
    env.LOCALAPPDATA,
    env.XDG_CONFIG_HOME,
    env.XDG_DATA_HOME,
    env.XDG_CACHE_HOME,
    env.XDG_STATE_HOME,
    NodePath.join(isnadiHome, "userdata"),
  ]) {
    NodeFS.mkdirSync(directory, { recursive: true });
  }

  NodeFS.writeFileSync(
    NodePath.join(isnadiHome, "userdata", "settings.json"),
    JSON.stringify({
      providerInstances: {
        [STUB_INSTANCE_ID]: {
          driver: "customOpenai",
          displayName: "E2E stub",
          config: { baseUrl: stub.baseUrl, customModels: [STUB_MODEL] },
        },
      },
    }),
  );

  const app = await electron.launch({
    executablePath: resolveSmokeElectronPath(),
    args: [
      "--no-default-browser-check",
      "--no-default-protocol-client",
      `--user-data-dir=${NodePath.join(root, "chromium")}`,
      NodePath.join(DESKTOP_DIR, "dist-electron/main.cjs"),
    ],
    cwd: DESKTOP_DIR,
    env: { ...env, ISNADI_HOME: isnadiHome, T3CODE_HOME: isnadiHome },
    timeout: 180_000,
  });

  const page = await app.firstWindow({ timeout: 180_000 });
  await page.waitForLoadState("domcontentloaded");

  // First-run onboarding is a renderer-local flag. Mark it done on this fresh profile so the
  // journey starts on the workspace; the fleet flow itself is not skipped.
  await page.evaluate((key) => window.localStorage.setItem(key, "1"), ONBOARDING_COMPLETED_KEY);
  await page.reload({ waitUntil: "domcontentloaded" });

  NodeFS.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  return {
    app,
    page,
    stub,
    root,
    shot: async (step) => {
      const path = NodePath.join(ARTIFACTS_DIR, `${name}-${step}.png`);

      await page.screenshot({ path, fullPage: false });

      return path;
    },
    close: async () => {
      await app.close().catch(() => undefined);
      await stub.close();
      NodeFS.rmSync(root, { recursive: true, force: true });
    },
  };
}
