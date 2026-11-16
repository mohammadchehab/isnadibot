import { SkillId } from "@isnadi/contracts";
import { createTranslator } from "@isnadi/client-runtime/i18n";
import type { RegistrySkill } from "@isnadi/client-runtime/skills";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { SkillAddDialog } from "./SkillAddDialog";
import { SkillApproveDialog } from "./SkillApproveDialog";

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: createTranslator("en").translate }),
}));

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (children: ReactNode) => children,
}));

// Dialogs mount their popups after hydration, so render them inline when open.
vi.mock("../ui/dialog", async (importOriginal) => {
  const Pass = ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>;

  return {
    ...(await importOriginal<typeof import("../ui/dialog")>()),
    Dialog: ({ open, children }: { readonly open: boolean; readonly children?: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogPanel: Pass,
    DialogPopup: Pass,
    DialogTitle: Pass,
  };
});

const mocks = vi.hoisted(() => ({
  addSkill: () => ({ kind: "refused", refusal: "link-not-found" }) as const,
  approveSkill: () => undefined,
  removeSkill: () => undefined,
}));

vi.mock("@isnadi/client-runtime/skills", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@isnadi/client-runtime/skills")>()),
  useSkillRegistryActions: () => mocks,
}));

function skill(overrides: Partial<RegistrySkill> & { readonly name: string }): RegistrySkill {
  return {
    id: SkillId.make(`provider:all:${overrides.name}`),
    description: `${overrides.name} does a thing.`,
    source: "provider",
    providerDriver: "claude",
    sizeTokens: 1_200,
    fileCount: 3,
    contentHash: "abc1234",
    approval: "not-needed",
    requires: [],
    usedBy: [],
    ...overrides,
  };
}

const community = skill({
  id: SkillId.make("community:recruiting:salary-benchmark"),
  name: "salary-benchmark",
  source: "community",
  sizeTokens: 2_400,
  approval: "needs-approval",
  origin: { url: "https://github.com/acme/recruiting-skills", commit: "4f2a1c9" },
  instructions: "# salary-benchmark\nFind candidates who match an opening.",
  files: [
    { path: "SKILL.md", sizeTokens: 1_400 },
    { path: "references/scoring.md", sizeTokens: 2_100 },
  ],
});

describe("the add-skill dialogs", () => {
  it("draws the provider list, the scope rows and the note", () => {
    const markup = renderToStaticMarkup(
      <SkillAddDialog
        skills={[skill({ name: "candidate-search" })]}
        onClose={() => undefined}
        onNeedsApproval={() => undefined}
      />,
    );

    expect(markup).toContain("Add a skill");
    expect(markup).toContain("A skill is a folder with a SKILL.md.");
    expect(markup).toContain("Claude");
    expect(markup).toContain("candidate-search");
    expect(markup).toContain("Travels with this space&#x27;s project.");
    expect(markup).toContain("The provider keeps its copy.");
    expect(markup).toContain("Add skill");
  });

  it("names the project in the This space row, and says where an all-spaces skill goes", () => {
    const markup = renderToStaticMarkup(
      <SkillAddDialog
        skills={[]}
        projectName="Recruiting"
        onClose={() => undefined}
        onNeedsApproval={() => undefined}
      />,
    );

    expect(markup).toContain("Recruiting. The skill travels with this project.");
    expect(markup).toContain("Every space you open on this computer.");
  });

  it("keeps the primary inert until the URL field holds a link", () => {
    const markup = renderToStaticMarkup(
      <SkillAddDialog
        skills={[]}
        initialSource="github"
        onClose={() => undefined}
        onNeedsApproval={() => undefined}
      />,
    );

    expect(markup).toContain("Paste a GitHub link to a skill folder.");
    expect(markup).toContain("Check the link");
    expect(markup).toContain("disabled");
  });

  it("draws the approval dialog with what the bot will be told", () => {
    const markup = renderToStaticMarkup(
      <SkillApproveDialog skill={community} onClose={() => undefined} />,
    );

    expect(markup).toContain("Add this skill?");
    expect(markup).toContain("Read what it does before a bot can use it.");
    expect(markup).toContain("github.com/acme/recruiting-skills");
    expect(markup).toContain("Commit 4f2a1c9 · 3 files · 2.4k");
    expect(markup).toContain("What the bot will be told");
    expect(markup).toContain("# salary-benchmark");
    expect(markup).toContain("references/scoring.md");
    expect(markup).toContain("Approving pins this commit.");
    expect(markup).toContain("Approve");
  });
});
