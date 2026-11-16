import {
  ProviderDriverKind,
  ProviderInstanceId,
  FleetHireBlocker,
  type ServerProvider,
} from "@isnadi/contracts";
import type { Translate } from "@isnadi/client-runtime/state/runtime";
import { Schema } from "effect";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  SquadSetupHardBlockBand,
  squadSetupCaptionBlocker,
  squadSetupHardBlock,
  squadSetupHardBlockMessage,
} from "./SquadSetupHardBlock";

const decodeBlocker = Schema.decodeUnknownSync(FleetHireBlocker);

// A real role: the band reads the blocked role's driver to decide which provider
// to name, so the fixture has to be one the catalogue knows.
const noProvider = decodeBlocker({ kind: "no-provider", roleId: "scout" });

const emptyName = decodeBlocker({ kind: "empty-name", roleId: "scout" });

const duplicateName = decodeBlocker({ kind: "duplicate-name", names: ["alex"] });

describe("squad setup hard blocks", () => {
  it("reads a client without the write scope as hard-blocked, whatever else blocks it", () => {
    expect(squadSetupHardBlock(true, [])).toBe("environment-rights");
    expect(squadSetupHardBlock(true, [noProvider])).toBe("environment-rights");
    expect(squadSetupHardBlock(true, [emptyName])).toBe("environment-rights");
    expect(squadSetupHardBlock(true, [emptyName, noProvider])).toBe("environment-rights");
  });

  it("reads a squad with no provider to run it as hard-blocked", () => {
    expect(squadSetupHardBlock(false, [noProvider])).toBe("no-provider");
  });

  it("finds the missing provider behind a blocker the plan reports first", () => {
    // planFleetHire pushes empty-name before no-provider for the same member, so
    // [empty-name, no-provider] is the frame's state and must still draw the band.
    expect(squadSetupHardBlock(false, [emptyName, noProvider])).toBe("no-provider");
    expect(squadSetupHardBlock(false, [duplicateName, noProvider])).toBe("no-provider");
  });

  it("leaves the reasons the user clears on this screen without a band", () => {
    expect(squadSetupHardBlock(false, [emptyName])).toBeNull();
    expect(squadSetupHardBlock(false, [duplicateName])).toBeNull();
    expect(squadSetupHardBlock(false, [])).toBeNull();
  });
});

describe("squad setup footer caption", () => {
  it("still names a blocker the user fixes here while the band carries the hard block", () => {
    expect(squadSetupCaptionBlocker([noProvider, emptyName])).toEqual(emptyName);
  });

  it("leaves the footer to Create alone when the band carries the only reason", () => {
    expect(squadSetupCaptionBlocker([noProvider])).toBeUndefined();
    expect(squadSetupCaptionBlocker([])).toBeUndefined();
  });
});

describe("squad setup hard block message", () => {
  const t = ((key: string, params?: { readonly provider?: string }) =>
    params?.provider === undefined ? key : key.replace("{provider}", params.provider)) as Translate;

  const provider = (driver: string, overrides: Partial<ServerProvider> = {}): ServerProvider => ({
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-13T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  });

  const claude = provider("claudeAgent", { displayName: "Claude" });

  it("names the provider whose saved sign-in is what stops the hire", () => {
    expect(
      squadSetupHardBlockMessage(
        "no-provider",
        [noProvider],
        [{ ...claude, unavailability: "expired-login" }],
        t,
      ),
    ).toBe("Claude sign-in expired or revoked. Reconnect it in Settings > Providers.");
  });

  it("keeps the generic sentence when no provider is left to name", () => {
    expect(squadSetupHardBlockMessage("no-provider", [noProvider], [], t)).toBe(
      "No provider can run this bot yet.",
    );
    // A provider that is merely off or missing is not a sign-in the band can fix.
    expect(
      squadSetupHardBlockMessage(
        "no-provider",
        [noProvider],
        [provider("claudeAgent", { enabled: false })],
        t,
      ),
    ).toBe("No provider can run this bot yet.");
  });

  it("names no provider for a reason other than the missing one", () => {
    expect(
      squadSetupHardBlockMessage(
        "no-provider",
        [emptyName],
        [{ ...claude, unavailability: "expired-login" }],
        t,
      ),
    ).toBe("No provider can run this bot yet.");
  });
});

describe("squad setup hard block band", () => {
  const noop = () => {};

  it("draws the reason as the frame's warning Alert", () => {
    const markup = renderToStaticMarkup(
      <SquadSetupHardBlockBand
        hardBlock="no-provider"
        message="No provider can run this bot yet."
        onOpenSettings={noop}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("bg-warning-surface");
    expect(markup).toContain("No provider can run this bot yet.");
  });

  it("offers the frame's way out when no provider can run the squad", () => {
    const markup = renderToStaticMarkup(
      <SquadSetupHardBlockBand
        hardBlock="no-provider"
        message="No provider can run this bot yet."
        onOpenSettings={noop}
      />,
    );

    // Frame 2f: Button Outline xs, "Open Settings", in the band's action slot.
    expect(markup).toContain("Open Settings");
    expect(markup).toContain('data-slot="alert-action"');
  });

  it("offers no action when the environment's rights are the block", () => {
    // A settings page cannot grant them, so a button there would lead nowhere.
    const markup = renderToStaticMarkup(
      <SquadSetupHardBlockBand
        hardBlock="environment-rights"
        message="This environment does not allow you to hire bots."
        onOpenSettings={noop}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain("Open Settings");
    expect(markup).not.toContain('data-slot="alert-action"');
  });

  it("draws nothing for a screen no hard block is on", () => {
    expect(
      renderToStaticMarkup(
        <SquadSetupHardBlockBand hardBlock={null} message={null} onOpenSettings={noop} />,
      ),
    ).toBe("");
  });
});
