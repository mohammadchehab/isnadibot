import { FLEET_TEMPLATES } from "@isnadi/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SquadSetupHeading } from "./SquadSetupHeading";

const heading = (templateName: string): string =>
  /<h1[^>]*>([^<]*)<\/h1>/.exec(
    renderToStaticMarkup(<SquadSetupHeading templateName={templateName} />),
  )?.[1] ?? "";

describe("squad setup heading", () => {
  it("names the fleet being set up, with its name mid-sentence", () => {
    expect(heading("Software engineering")).toBe("Set up your software engineering squad");
    expect(heading("Health research")).toBe("Set up your health research squad");
    expect(heading("Recruiting")).toBe("Set up your recruiting squad");
  });

  it("gives every template its own heading", () => {
    const titles = FLEET_TEMPLATES.map((template) => heading(template.name));

    expect(new Set(titles).size).toBe(FLEET_TEMPLATES.length);
  });
});
