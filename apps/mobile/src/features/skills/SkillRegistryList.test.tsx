import { createSkillRegistryFixture } from "@isnadi/client-runtime/skills";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({
  Text: ({ children }: { readonly children?: ReactNode }) => createElement("span", {}, children),
  View: ({ children }: { readonly children?: ReactNode }) => createElement("div", {}, children),
}));

vi.mock("../../components/AppText", () => ({
  AppText: ({ children }: { readonly children?: ReactNode }) => createElement("span", {}, children),
}));

vi.mock("../../lib/i18n", async () => {
  const { createTranslator } = await import("@isnadi/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useMobileI18n: () => ({ ...translator, t: translator.translate }) };
});

import { SkillRegistryList } from "./SkillRegistryList";

const registry = createSkillRegistryFixture({ dev: true });

function render(): string {
  const snapshot = registry.getSnapshot();

  return renderToStaticMarkup(
    createElement(SkillRegistryList, {
      skills: snapshot.skills,
      unavailableConnectors: snapshot.unavailableConnectors,
    }),
  );
}

describe("mobile skill registry list", () => {
  it("heads the community group with the approval suffix", () => {
    expect(render()).toContain("Community · needs your approval");
  });

  it("draws the state word and the Yours badge on their rows", () => {
    const markup = render();

    expect(markup).toContain("Needs approval");
    expect(markup).toContain("Yours");
  });

  it("reads a size as what loads when the skill is used", () => {
    expect(render()).toContain("1.8k");
  });
});
