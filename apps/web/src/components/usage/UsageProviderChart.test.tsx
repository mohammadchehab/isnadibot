import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { usageValueFormat, UsageProviderChart } from "./UsageProviderChart";

describe("UsageProviderChart", () => {
  it("says there is no activity instead of rendering an empty plot", () => {
    const markup = renderToStaticMarkup(
      <UsageProviderChart
        providers={["codex"]}
        days={["2026-09-18", "2026-09-19"]}
        daily={[]}
        hours={[]}
        hourly={[]}
        metric="cost"
        referenceTime={undefined}
        resolution="day"
        timeZone="UTC"
        unpriced={false}
      />,
    );

    expect(markup).toContain("No activity in this window.");
    expect(markup).not.toContain("<svg");
  });
});

describe("usageValueFormat", () => {
  const format = {
    usd: (value: number) => `$${value.toFixed(2)}`,
    tokens: (value: number) => `${value}t`,
  };

  it("refuses to print a dollar figure for a window with nothing priced", () => {
    const render = usageValueFormat("cost", true, format);

    expect(render(0)).toBe("—");
    expect(render(0)).not.toContain("$");
  });

  it("prints dollars again once some record in the window carries a price", () => {
    const render = usageValueFormat("cost", false, format);

    expect(render(0)).toBe("$0.00");
    expect(render(12.5)).toBe("$12.50");
  });

  it("leaves the token metric alone, because tokens are never unpriced", () => {
    expect(usageValueFormat("tokens", true, format)(0)).toBe("0t");
  });
});
