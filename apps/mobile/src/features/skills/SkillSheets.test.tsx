import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({
  Modal: "div",
  Pressable: ({ children }: { readonly children?: ReactNode }) =>
    createElement("div", null, children),
  ScrollView: "div",
  View: "div",
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock("../../components/AppText", () => ({ AppText: "span" }));

vi.mock("../../components/AppSymbol", () => ({ SymbolView: () => null }));

// The checkmark's tint comes from uniwind, which cannot load outside a native runtime; the tint
// is not what these assertions read.
vi.mock("../../lib/useThemeColor", () => ({ useThemeColor: () => undefined }));

// The theme colour comes from uniwind, which cannot load outside a native runtime; the tint is
// not what these assertions read.
vi.mock("../../lib/useThemeColor", () => ({ useThemeColor: () => undefined }));

vi.mock("../../lib/i18n", async () => {
  const { createTranslator } = await import("@isnadi/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useMobileI18n: () => ({ ...translator, t: translator.translate }) };
});

// The seam's hooks read React's store, and this suite renders through react-dom rather than a
// native runtime; the sheets' writes are stubbed, everything else is the real module.
const actions = vi.hoisted(() => ({
  addSkill: vi.fn(),
  approveSkill: vi.fn(),
  removeSkill: vi.fn(),
}));

vi.mock("@isnadi/client-runtime/skills", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@isnadi/client-runtime/skills")>();

  return { ...actual, useSkillRegistryActions: () => actions };
});

import { createSkillRegistryFixture, type RegistrySkill } from "@isnadi/client-runtime/skills";

import { SkillAddSheet } from "./SkillAddSheet";
import { SkillApproveSheet } from "./SkillApproveSheet";

const snapshot = createSkillRegistryFixture({ dev: true }).getSnapshot();

function skillNamed(name: string): RegistrySkill {
  const skill = snapshot.skills.find((candidate) => candidate.name === name);

  if (skill === undefined) throw new Error(`the fixture lists no ${name}`);

  return skill;
}

function renderAdd(): string {
  return renderToStaticMarkup(
    createElement(SkillAddSheet, {
      skills: snapshot.skills,
      projectName: snapshot.projectName,
      onClose: () => undefined,
      onNeedsApproval: () => undefined,
    }),
  );
}

function renderApprove(): string {
  return renderToStaticMarkup(
    createElement(SkillApproveSheet, {
      skill: skillNamed("salary-benchmark"),
      onClose: () => undefined,
    }),
  );
}

describe("the mobile add-a-skill sheet", () => {
  it("names the project it adds to and the provider skills it can add", () => {
    const markup = renderAdd();

    expect(markup).toContain("Add a skill");
    expect(markup).toContain("Recruiting · this computer");
    expect(markup).toContain("From a provider");
    expect(markup).toContain("browser-scrape");
    expect(markup).toContain("codex-review");
    expect(markup).toContain("1.9k");
  });

  it("offers both scopes and says the archive route is the desktop app", () => {
    const markup = renderAdd();

    expect(markup).toContain("Add to");
    expect(markup).toContain("This space");
    expect(markup).toContain("All spaces");
    expect(markup).toContain("A .zip has to be uploaded from the desktop app.");
    expect(markup).toContain("Add skill");
  });
});

describe("the mobile approve-a-skill sheet", () => {
  it("leads with where the skill came from and the commit it pins", () => {
    const markup = renderApprove();

    expect(markup).toContain("Approve this skill?");
    expect(markup).toContain("Community · salary-benchmark");
    expect(markup).toContain("github.com/acme/recruiting-skills");
    expect(markup).toContain("Commit 4f2a1c9 · 3 files · 2.4k");
  });

  it("shows what the bot will be told, the files, and both ways out", () => {
    const markup = renderApprove();

    expect(markup).toContain("What the bot will be told");
    expect(markup).toContain("# salary-benchmark");
    expect(markup).toContain("Files");
    expect(markup).toContain("SKILL.md");
    expect(markup).toContain("references/scoring.md");
    expect(markup).toContain(
      "Approving pins this commit. If the folder changes, Isnadi asks again.",
    );
    expect(markup).toContain("Cancel");
    expect(markup).toContain("Approve");
  });
});
