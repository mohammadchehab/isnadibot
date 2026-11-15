import { createTranslator } from "@isnadi/client-runtime/i18n";
import * as Cause from "effect/Cause";
import { describe, expect, it, vi } from "vite-plus/test";

import { useCreateGroup } from "./useCreateGroup";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  toast: vi.fn(),
  navigate: vi.fn(),
}));

// Every hook this module calls is replaced, so the hook can be invoked as a
// plain function and only the toast it adds is under test.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return { ...actual, useCallback: <T>(callback: T) => callback };
});

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: createTranslator("en").translate }),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));

vi.mock("../../state/environments", () => ({ usePrimaryEnvironmentId: () => "environment-1" }));

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.create }));

vi.mock("../ui/toast", () => ({ toastManager: { add: mocks.toast } }));

const input = { name: "Launch crew", bossBotId: "bot-a", specialistBotIds: ["bot-b"] };

describe("useCreateGroup", () => {
  it("shows the coded refusal as the toast description, keeping the title", async () => {
    mocks.create.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.fail({
        _tag: "OrchestrationCommandInvariantError",
        message: "Bot 'bot-b' already belongs to group 'group-home'.",
        refusal: "bot-in-another-group",
      }),
    });

    const create = useCreateGroup();

    await expect(create(input)).resolves.toBeNull();

    expect(mocks.toast).toHaveBeenCalledWith({
      type: "error",
      title: "Could not create group",
      description:
        "This bot belongs to another space. Create this space without it, then add the bot.",
    });
  });

  it("keeps the server's own sentence for a code this client does not know", async () => {
    mocks.create.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.fail({ refusal: "quota-exceeded", message: "Quota reached." }),
    });

    const create = useCreateGroup();

    await expect(create(input)).resolves.toBeNull();

    expect(mocks.toast).toHaveBeenCalledWith({
      type: "error",
      title: "Could not create group",
      description: "Quota reached.",
    });
  });
});
