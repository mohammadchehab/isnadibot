import type { LaunchOptions } from "playwright-core";

/**
 * Absolute path of the Chromium build the host provides for browser tests, read from
 * `ISNADI_CHROMIUM_PATH`. CI sets it to the pinned install that `scripts/ci/install-chromium.sh`
 * writes (see docs/internals/ci.md); a developer points it at any Chrome for Testing download.
 *
 * Returns undefined when the variable is unset, which is how a browser test skips instead of
 * failing on a host that provides no Chromium (a fork pull request's GitHub-hosted runner). A
 * variable that is set is used as-is: if it points at no working browser the launch fails the test,
 * so a broken runner install never turns the browser tests into a silent no-op.
 */
export function chromiumBinaryPath(): string | undefined {
  const configured = process.env.ISNADI_CHROMIUM_PATH?.trim() ?? "";

  return configured === "" ? undefined : configured;
}

/**
 * Launch options for the host's Chromium, or undefined when the host provides none.
 *
 * `--no-sandbox` is required, not defensive: the Hetzner box runs Ubuntu 24.04, whose AppArmor
 * restrictions on unprivileged user namespaces make Chromium abort with "No usable sandbox"
 * unless the sandbox is off. `--disable-dev-shm-usage` keeps rendering inside a small `/dev/shm`.
 */
export function chromiumLaunchOptions(): LaunchOptions | undefined {
  const executablePath = chromiumBinaryPath();

  if (executablePath === undefined) {
    return undefined;
  }

  return {
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  };
}
