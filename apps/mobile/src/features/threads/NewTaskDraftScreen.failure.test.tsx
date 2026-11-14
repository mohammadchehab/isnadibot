import * as Cause from "effect/Cause";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * Guards the screen's wiring, not the helper's copy: reverting the failure
 * branch to `error.message` must fail here. The mobile app has no screen-level
 * harness for this route, so the modules below are stubbed and the screen is
 * rendered to static markup, the same way `ThreadChannels.test.tsx` does it.
 */
const state = vi.hoisted(() => {
  const project = {
    id: "project-1",
    environmentId: "environment-1",
    title: "Selected workspace",
  };

  const modelSelection = { providerDriver: "codex", modelId: "model-1", reasoningEffort: null };

  return {
    pressables: [] as Array<{ accessibilityLabel?: string; onPress?: () => void }>,
    alerts: [] as Array<{ title: string; message: string }>,
    createProjectThread: vi.fn(),
    project,
    modelSelection,
    flow: {
      projectScopes: [],
      selectedProject: project,
      selectedProjectKey: "environment-1:project-1",
      setProject: vi.fn(),
      prompt: "Start the chat",
      attachments: [],
      setPrompt: vi.fn(),
      appendAttachments: vi.fn(),
      removeAttachment: vi.fn(),
      draftKey: "draft-1",
      environments: [],
      selectedEnvironmentId: "environment-1",
      selectedModel: modelSelection,
      selectedModelOption: { providerDriver: "codex", label: "Codex" },
      selectedProviderSkills: [],
      subscriptionStatuses: [],
      runtimeMode: "default",
      submitting: false,
      setSubmitting: vi.fn(),
      editingPendingTask: null,
      buildPendingTaskMessage: () => null,
      beginEditingPendingTask: () => false,
      cancelEditingPendingTask: vi.fn(),
      finishEditingPendingTask: vi.fn(),
    },
  };
});

vi.mock("../../lib/i18n", async () => {
  const { createTranslator } = await import("@isnadi/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useMobileI18n: () => ({ ...translator, t: translator.translate }) };
});

vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");

  const collect = (props: {
    accessibilityLabel?: string;
    onPress?: () => void;
    children?: ReactNode;
  }) => {
    state.pressables.push(props);

    return h("button", null, props.children);
  };

  return {
    Alert: {
      alert: (title: string, message: string) => state.alerts.push({ title, message }),
    },
    Platform: { OS: "ios" },
    Pressable: collect,
    ScrollView: (props: { children?: ReactNode }) => h("div", null, props.children),
    View: (props: { children?: ReactNode }) => h("div", null, props.children),
  };
});

vi.mock("react-native-keyboard-controller", async () => {
  const { createElement: h } = await import("react");

  return {
    KeyboardController: { dismiss: vi.fn() },
    KeyboardStickyView: (props: { children?: ReactNode }) => h("div", null, props.children),
    useKeyboardState: () => false,
  };
});

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    dispatch: vi.fn(),
    goBack: vi.fn(),
    getParent: () => ({ setOptions: vi.fn(), goBack: vi.fn() }),
  }),
  usePreventRemove: () => undefined,
  StackActions: {
    replace: (name: string, params?: Readonly<Record<string, string>>) => ({
      type: "replace",
      name,
      params,
    }),
  },
}));

vi.mock("../../native/StackHeader", () => ({
  NativeHeaderToolbar: () => null,
  NativeStackScreenOptions: () => null,
}));

vi.mock("../../components/AppText", async () => {
  const { createElement: h } = await import("react");

  return {
    AppText: (props: { children?: ReactNode }) => h("span", null, props.children),
  };
});

vi.mock("../../components/ComposerEditor", async () => {
  const { createElement: h, forwardRef: ref } = await import("react");

  return { ComposerEditor: ref(() => h("div")) };
});

vi.mock("../../components/ComposerToolbar", async () => {
  const { createElement: h } = await import("react");

  const block = (props: { children?: ReactNode }) => h("div", null, props.children);

  const control = (props: {
    accessibilityLabel?: string;
    onPress?: () => void;
    children?: ReactNode;
  }) => {
    state.pressables.push(props);

    return h("button", null, props.children);
  };

  return {
    ComposerToolbarRow: block,
    ComposerToolbarScroller: block,
    ComposerToolbarButton: control,
    ComposerInlineControl: control,
  };
});

vi.mock("../../components/DictationControls", () => ({ DictationControls: () => null }));

vi.mock("../../components/AndroidScreenHeader", () => ({ AndroidScreenHeader: () => null }));

vi.mock("../../components/ComposerAttachmentStrip", () => ({
  ComposerAttachmentStrip: () => null,
}));

vi.mock("../../components/ProviderIcon", () => ({ ProviderIcon: () => null }));

vi.mock("./composer-surface", async () => {
  const { createElement: h } = await import("react");

  return {
    ComposerSurface: (props: { children?: ReactNode }) => h("div", null, props.children),
  };
});

vi.mock("./use-thread-settings-sheet-presentation", () => ({
  useThreadSettingsSheetRoute: () => ({ open: vi.fn() }),
}));

vi.mock("@isnadi/client-runtime/dictation", () => ({
  composerActionIsDictation: () => false,
}));

vi.mock("../../lib/useEnvironmentComposerDictation", () => ({
  useEnvironmentComposerDictation: () => ({ status: "idle" }),
}));

vi.mock("../../lib/useThemeColor", () => ({ useThemeColor: () => "black" }));

vi.mock("../../lib/mobileTheme", () => ({ themeColorWithAlpha: () => "transparent" }));

vi.mock("../../lib/useFontFamily", () => ({ useFontFamily: () => "sans-serif" }));

vi.mock("../../lib/commandMetadata", () => ({ createTurnCommandMetadata: () => ({}) }));

vi.mock("../../lib/composerImages", () => ({
  convertPastedImagesToAttachments: vi.fn(),
  pickComposerImages: vi.fn(),
}));

vi.mock("../../lib/modelOptions", () => ({
  resolveSelectableModelSelection: () => state.modelSelection,
}));

vi.mock("../settings/appearance/useScaledTextRole", () => ({
  useScaledTextRole: () => ({ fontSize: 16, lineHeight: 22 }),
}));

vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeAppearance: "light" }),
}));

vi.mock("../../state/use-composer-drafts", () => ({
  clearComposerDraftContent: vi.fn(),
  getComposerDraftSnapshot: () => ({
    text: "Start the chat",
    attachments: [],
    modelSelection: null,
    runtimeMode: null,
  }),
}));

vi.mock("../../state/entities", () => ({
  useProjects: () => [state.project],
  useEnvironmentServerConfig: () => ({}),
}));

vi.mock("../../state/thread-outbox", () => ({
  enqueueThreadOutboxMessage: vi.fn(),
  removeThreadOutboxMessage: vi.fn(),
}));

vi.mock("../../state/use-remote-environment-registry", () => ({
  useRemoteConnectionStatus: () => ({
    connectedEnvironments: [{ environmentId: "environment-1", connectionState: "connected" }],
  }),
}));

vi.mock("./new-task-flow-provider", () => ({ useNewTaskFlow: () => state.flow }));

vi.mock("./use-project-actions", () => ({
  useCreateProjectThread: () => state.createProjectThread,
}));

vi.mock("./new-task-project-selection", () => ({ resolveDraftProjectSelection: () => null }));

vi.mock("./use-new-task-share-import", () => ({
  useNewTaskShareImport: () => ({
    isImportingShare: false,
    isCancellingShareImport: false,
    isIncomingShareTransferPending: false,
    isIncomingShareReady: true,
  }),
}));

import { NewTaskDraftScreen } from "./NewTaskDraftScreen";

/** A failure shaped like the server's `OrchestrationCommandInvariantError`: prose plus a code. */
function invariantFailure(detail: string, refusal?: string) {
  return {
    _tag: "Failure" as const,
    cause: Cause.fail(Object.assign(new Error(detail), refusal === undefined ? {} : { refusal })),
  };
}

async function pressStartChat() {
  state.pressables = [];
  renderToStaticMarkup(createElement(NewTaskDraftScreen, {}));

  const start = state.pressables.find((entry) => entry.accessibilityLabel === "Start chat");

  expect(start?.onPress).toBeDefined();
  start?.onPress?.();

  for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
}

beforeEach(() => {
  state.pressables = [];
  state.alerts = [];
  state.createProjectThread.mockReset();
});

describe("mobile new task screen failures", () => {
  it("shows the membership sentence, not the server's prose, when a stranger starts a chat", async () => {
    state.createProjectThread.mockResolvedValue(
      invariantFailure(
        "Person 'person-9' is not a member of group 'group-7'.",
        "actor-not-a-group-member",
      ),
    );

    await pressStartChat();

    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0]?.title).toBe("Could not start chat");
    expect(state.alerts[0]?.message).toBe(
      "You are not a member of this space. Ask the person who runs it for access.",
    );
    expect(state.alerts[0]?.message).not.toContain("Person '");
    expect(state.alerts[0]?.message).not.toContain("Group '");
    expect(state.alerts[0]?.message).not.toContain("person-9");
    expect(state.alerts[0]?.message).not.toContain("group-7");
  });

  it("keeps the screen's own wording when the server sends no sentence", async () => {
    state.createProjectThread.mockResolvedValue({
      _tag: "Failure" as const,
      cause: Cause.fail(new Error("   ")),
    });

    await pressStartChat();

    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0]?.message).toBe("The chat could not be started.");
  });
});
