import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const bot = vi.hoisted(() => ({ spaceName: null as string | null }));

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Platform: { OS: "ios" },
  Pressable: ({ children }: { readonly children?: ReactNode }) =>
    createElement("button", null, children),
  ScrollView: "div",
  View: "div",
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: vi.fn() }),
  useRoute: () => ({ params: { environmentId: "environment", botId: "bot-1" } }),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => (bot.spaceName ? [{ id: "group-1", name: bot.spaceName }] : []),
}));

vi.mock("../../components/AppText", () => ({ AppText: "span" }));

vi.mock("../../components/AndroidScreenHeader", () => ({ AndroidScreenHeader: () => null }));

vi.mock("../../components/ThemedSwitch", () => ({ ThemedSwitch: () => createElement("span") }));

vi.mock("../../native/StackHeader", () => ({ NativeStackScreenOptions: () => null }));

vi.mock("../../state/bots", () => ({
  botEnvironment: { update: {} },
  environmentGroupsAtom: () => ({}),
}));

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));

vi.mock("../../state/use-thread-engine-bot", () => ({
  useThreadEngineBot: () => ({
    id: "bot-1",
    name: "Scout",
    groupId: bot.spaceName ? "group-1" : null,
    archivedAt: null,
    skills: [
      { skillId: "release-notes", enabled: true },
      { skillId: "triage", enabled: false },
    ],
    skillRegistryAccess: true,
  }),
}));

vi.mock("@isnadi/client-runtime/skills", () => ({
  useBotSkills: () => ({
    state: "ready",
    registryAccess: true,
    entries: [
      {
        skillId: "release-notes",
        enabled: true,
        skill: { id: "release-notes", name: "Release notes", description: "Writes them." },
      },
      {
        skillId: "triage",
        enabled: false,
        skill: { id: "triage", name: "Triage", description: "Sorts bugs." },
      },
    ],
  }),
}));

vi.mock("../../lib/i18n", async () => {
  const { createTranslator } = await import("@isnadi/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useMobileI18n: () => ({ ...translator, t: translator.translate }) };
});

import { BotSkillsScreen } from "./BotSkillsScreen";

describe("a bot's skills sheet", () => {
  it("draws the bot's own skills, the registry switch and the note", () => {
    const markup = renderToStaticMarkup(<BotSkillsScreen />);

    expect(markup).toContain("Scout&#x27;s skills");
    expect(markup).toContain("1 on");
    expect(markup).toContain("On for this bot");
    expect(markup).toContain("Release notes");
    expect(markup).toContain("Writes them.");
    expect(markup).toContain("Triage");
    expect(markup).toContain("Anywhere");
    expect(markup).toContain("Use other skills from the registry");
    expect(markup).toContain("Turning a skill off keeps it in the space.");
  });

  it("names the space the bot belongs to in the subtitle", () => {
    bot.spaceName = "Platform";

    expect(renderToStaticMarkup(<BotSkillsScreen />)).toContain("Platform · 1 on");

    bot.spaceName = null;
  });
});
