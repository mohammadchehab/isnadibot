import { createTranslator } from "@isnadi/client-runtime/i18n";
import * as Cause from "effect/Cause";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
  // The mocks are hoisted, so a call recorded by one test would otherwise be
  // read back by the next one's `mock.calls[0]`.
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    expect(mocks.toast.mock.calls[0]?.[0]?.description).not.toContain("group-home");
    expect(mocks.toast.mock.calls[0]?.[0]?.description).not.toContain("bot-b");
  });

  it("keeps the title-only toast for a code this client does not know", async () => {
    mocks.create.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.fail({ refusal: "quota-exceeded", message: "Quota reached." }),
    });

    const create = useCreateGroup();

    await expect(create(input)).resolves.toBeNull();

    expect(mocks.toast).toHaveBeenCalledWith({ type: "error", title: "Could not create group" });
    expect(mocks.toast.mock.calls[0]?.[0]).not.toHaveProperty("description");
  });

  // A real throw from group.create's own chain, not a synthetic one: the
  // under-two-member check in decider/groups.ts is uncoded today and names the
  // group id, and it is the one throw TASK-288 does not reach.
  it("keeps the title-only toast for an uncoded refusal, so no raw id is shown", async () => {
    mocks.create.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.fail({
        _tag: "OrchestrationCommandInvariantError",
        commandType: "group.create",
        message: "Group 'group-1' requires at least two active bots.",
      }),
    });

    const create = useCreateGroup();

    await expect(create(input)).resolves.toBeNull();

    expect(mocks.toast).toHaveBeenCalledWith({ type: "error", title: "Could not create group" });
    expect(mocks.toast.mock.calls[0]?.[0]).not.toHaveProperty("description");
  });
});
