import { LINK_MONITOR_BOT_ID, READY_MADE_BOTS, type ReadyMadeBotId } from "@isnadi/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { LanguageProvider } from "../../i18n";

import { ReadyMadeBotPicker } from "./ReadyMadeBotPicker";

function renderPicker(selected: ReadyMadeBotId | null) {
  return renderToStaticMarkup(
    <LanguageProvider>
      <ReadyMadeBotPicker selected={selected} timezone="Europe/Amsterdam" onSelect={() => {}} />
    </LanguageProvider>,
  );
}

/** The markup of one button row, so a row's state can be read without its neighbours. */
function row(markup: string, testId: string) {
  return markup.split(`data-testid="${testId}"`)[1]?.split("</button>")[0] ?? "";
}

describe("ReadyMadeBotPicker", () => {
  it("offers from scratch and a row for every ready-made bot", () => {
    const markup = renderPicker(null);

    expect(markup).toContain("Start with");
    expect(markup).toContain("From scratch");
    expect(markup).toContain("Name a bot and pick its look yourself.");

    for (const bot of READY_MADE_BOTS) {
      expect(markup).toContain(`data-testid="new-bot-preset-${bot.id}"`);
    }
    expect(markup.split('data-testid="new-bot-preset-').length - 1).toBe(READY_MADE_BOTS.length);
  });

  it("says what the link monitor does and when it starts before the user picks it", () => {
    const markup = renderPicker(null);

    expect(markup).toContain("Link monitor");
    expect(markup).toContain("Checks your docs on a schedule and reports every broken link.");
    expect(markup).toContain("Daily at 09:00 (Europe/Amsterdam)");
  });

  it("marks the picked preset as current, not from scratch", () => {
    const presetRow = row(
      renderPicker(LINK_MONITOR_BOT_ID),
      `new-bot-preset-${LINK_MONITOR_BOT_ID}`,
    );

    expect(presetRow).toContain('aria-pressed="true"');
    if (presetRow === "") throw new Error("the link monitor row is missing from the picker");
    expect(row(renderPicker(LINK_MONITOR_BOT_ID), "new-bot-start-from-scratch")).toContain(
      'aria-pressed="false"',
    );
  });

  it("marks from scratch as current while no preset is picked", () => {
    expect(row(renderPicker(null), "new-bot-start-from-scratch")).toContain('aria-pressed="true"');
    expect(row(renderPicker(null), `new-bot-preset-${LINK_MONITOR_BOT_ID}`)).toContain(
      'aria-pressed="false"',
    );
  });
});
