import { FleetHireBlocker } from "@isnadi/contracts";
import { Schema } from "effect";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  SquadSetupHardBlockBand,
  squadSetupCaptionBlocker,
  squadSetupHardBlock,
} from "./SquadSetupHardBlock";

const decodeBlocker = Schema.decodeUnknownSync(FleetHireBlocker);

const noProvider = decodeBlocker({ kind: "no-provider", roleId: "boss" });

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

describe("squad setup hard block band", () => {
  it("draws the reason as the frame's warning Alert", () => {
    const markup = renderToStaticMarkup(
      <SquadSetupHardBlockBand message="No provider can run this bot yet." />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("bg-warning-surface");
    expect(markup).toContain("No provider can run this bot yet.");
  });

  it("draws nothing for a screen no hard block is on", () => {
    expect(renderToStaticMarkup(<SquadSetupHardBlockBand message={null} />)).toBe("");
  });
});
