import { ProviderDriverKind, ProviderInstanceId } from "@isnadi/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/i18n", async () => {
  const { createTranslator } = await import("@isnadi/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useI18n: () => ({ ...translator, t: translator.translate }) };
});

import { provider } from "../../providerInstances.test-support";
import { deriveProviderInstanceEntries } from "../../providers/instanceCatalog";
import { ModelPickerSidebar } from "./ModelPickerSidebar";

/**
 * The rail draws two different "you cannot use this" states, and only one of them blocks the
 * click. `disabled` is the context's veto; `aria-disabled` is a row that stays browsable, so its
 * models can still be inspected (TASK-301 AC2).
 */
const entries = deriveProviderInstanceEntries([
  provider({ provider: ProviderDriverKind.make("codex"), instanceId: "codex" }),
  // Not installed: unavailable, but nothing in this picker has vetoed it.
  provider({
    provider: ProviderDriverKind.make("claudeAgent"),
    instanceId: "claude_personal",
    installed: false,
  }),
  provider({ provider: ProviderDriverKind.make("claude"), instanceId: "claude" }),
]);

function render(): string {
  return renderToStaticMarkup(
    <ModelPickerSidebar
      selectedInstanceId={ProviderInstanceId.make("codex")}
      onSelectInstance={() => {}}
      instanceEntries={entries}
      showFavorites={false}
      disabledInstanceIds={new Set([ProviderInstanceId.make("claude")])}
    />,
  );
}

/** The markup of one rail tile: from its provider marker up to the next tile's. */
function tile(markup: string, instanceId: string): string {
  const start = markup.indexOf(`data-model-picker-provider="${instanceId}"`);

  expect(start).toBeGreaterThan(-1);

  const next = markup.indexOf('data-model-picker-provider="', start + 1);

  return markup.slice(start, next === -1 ? undefined : next);
}

describe("ModelPickerSidebar disabled looks (TASK-301 AC2)", () => {
  it("keeps an unavailable tile clickable and marks it aria-disabled", () => {
    const unavailable = tile(render(), "claude_personal");

    expect(unavailable).toContain('aria-disabled="true"');
    // A `disabled` button fires no click; this row must still open its models.
    expect(unavailable).not.toContain(" disabled=");
  });

  it("keeps the context's veto on the real disabled attribute", () => {
    expect(tile(render(), "claude")).toContain(" disabled=");
  });

  it("carries one disabled weight, and it is the system's 64 percent", () => {
    const markup = render();

    expect(markup).toContain("disabled:opacity-64");
    expect(markup).toContain("aria-disabled:opacity-64");
    // The two hand-written weights this card deletes.
    expect(markup).not.toContain("opacity-50");
    expect(markup).not.toContain("opacity-60");
  });
});
