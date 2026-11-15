import { FLEET_TEMPLATES } from "@isnadi/contracts";
import { createHireDraft } from "@isnadi/client-runtime/fleet/hire";
import { createTranslator } from "@isnadi/client-runtime/i18n";
import * as Cause from "effect/Cause";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useCreateSquad } from "./useCreateSquad";

const mocks = vi.hoisted(() => ({
  hire: vi.fn(),
  toast: vi.fn(),
  navigate: vi.fn(),
  setState: vi.fn(<T>(_value: T) => {}),
}));

// Every hook this module calls is replaced, so the hook can be invoked as a
// plain function and only the toast it adds is under test.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    useCallback: <T>(callback: T) => callback,
    useEffect: () => undefined,
    useState: <T>(initial: T) => [initial, mocks.setState],
  };
});

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: createTranslator("en").translate }),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));

vi.mock("../../state/environments", () => ({ usePrimaryEnvironmentId: () => "environment-1" }));

vi.mock("../../state/environmentSnapshot", () => ({ useEnvironmentSnapshot: () => null }));

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.hire }));

vi.mock("../ui/toast", () => ({ toastManager: { add: mocks.toast } }));

const template = FLEET_TEMPLATES[0];

if (template === undefined) throw new Error("A fleet template is required for this test.");

const draft = createHireDraft({
  template,
  providers: [],
  makeId: () => "command-1",
  createdAt: "2026-01-01T00:00:00.000Z",
});

/** The refusal the server sends a paired client without the write scope. */
function environmentRightsRefusal() {
  return Cause.fail({
    _tag: "OrchestrationCommandInvariantError",
    commandType: "fleet.hire",
    message: "Person 'person-7f3a' needs 'access:write' to change the environment.",
    refusal: "environment-rights",
  });
}

describe("useCreateSquad", () => {
  // The mocks are hoisted, so a call recorded by one test would otherwise be
  // read back by the next one's `mock.calls[0]`.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names the refusal a failed command carried, without the person id", async () => {
    mocks.hire.mockResolvedValue({ _tag: "Failure", cause: environmentRightsRefusal() });

    const { create } = useCreateSquad();

    await create(draft, vi.fn());

    expect(mocks.toast).toHaveBeenCalledWith({
      type: "error",
      title: "Could not create the space",
      description: "Changing this environment needs permission. Ask the person who runs it.",
    });
    expect(mocks.toast.mock.calls[0]?.[0]?.description).not.toContain("person-7f3a");
    expect(mocks.toast.mock.calls[0]?.[0]?.description).not.toContain("access:write");
  });

  it("names the refusal a hire the server answered carries, keeping the draft", async () => {
    mocks.hire.mockResolvedValue({
      _tag: "Success",
      value: { status: "failed", outcome: "failed", draft, cause: environmentRightsRefusal() },
    });

    const recordFailure = vi.fn();
    const { create } = useCreateSquad();

    await create(draft, recordFailure);

    expect(recordFailure).toHaveBeenCalledWith(draft);
    expect(mocks.toast).toHaveBeenCalledWith({
      type: "error",
      title: "Could not create the space",
      description: "Changing this environment needs permission. Ask the person who runs it.",
    });
  });

  it("keeps the title alone when the socket dropped, since no server answered", async () => {
    mocks.hire.mockResolvedValue({
      _tag: "Success",
      value: { status: "failed", outcome: "unknown", draft },
    });

    const { create } = useCreateSquad();

    await create(draft, vi.fn());

    expect(mocks.toast).toHaveBeenCalledWith({
      type: "error",
      title: "Could not create the space",
    });
    expect(mocks.toast.mock.calls[0]?.[0]).not.toHaveProperty("description");
  });

  it("keeps the title alone for a refusal this client does not know", async () => {
    mocks.hire.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.fail({
        message: "Person 'person-7f3a' is over its hire quota.",
        refusal: "quota-exceeded",
      }),
    });

    const { create } = useCreateSquad();

    await create(draft, vi.fn());

    expect(mocks.toast).toHaveBeenCalledWith({
      type: "error",
      title: "Could not create the space",
    });
    expect(mocks.toast.mock.calls[0]?.[0]).not.toHaveProperty("description");
  });
});
