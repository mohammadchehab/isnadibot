import { describe, expect, it, vi } from "vite-plus/test";

/**
 * Guards the alert's shape, not its copy: the raw cause must be reachable through the "Show details"
 * button and must never sit in the alert's body, which is the app's own sentence.
 */
type CapturedButton = {
  readonly text: string;
  readonly style?: string;
  readonly onPress?: () => void;
};

const state = vi.hoisted(() => ({
  calls: [] as Array<{
    readonly title: string;
    readonly message: string;
    readonly buttons?: ReadonlyArray<CapturedButton>;
  }>,
}));

vi.mock("react-native", () => ({
  Alert: {
    alert: (title: string, message: string, buttons?: ReadonlyArray<CapturedButton>) => {
      state.calls.push(buttons === undefined ? { title, message } : { title, message, buttons });
    },
  },
}));

vi.mock("./i18n", async () => {
  const { createTranslator } = await import("@isnadi/client-runtime/i18n");
  const translator = createTranslator("en");

  return { translateOutsideReact: (message: string) => translator.translate(message) };
});

import { alertWithDetails } from "./alertWithDetails";

describe("alertWithDetails", () => {
  it("keeps the raw cause behind a Show details button", () => {
    state.calls = [];

    alertWithDetails("Update failed", "The update did not finish.", "ECONNREFUSED 127.0.0.1:8080");

    const call = state.calls[0];

    expect(call?.title).toBe("Update failed");
    expect(call?.message).toBe("The update did not finish.");
    expect(call?.message).not.toContain("ECONNREFUSED");
    expect(call?.buttons?.map((button) => button.text)).toEqual(["Show details", "Dismiss"]);
  });

  it("opens the raw cause when Show details is pressed", () => {
    state.calls = [];

    alertWithDetails("Update failed", "The update did not finish.", "ECONNREFUSED 127.0.0.1:8080");
    state.calls[0]?.buttons?.[0]?.onPress?.();

    expect(state.calls[1]?.message).toBe("ECONNREFUSED 127.0.0.1:8080");
  });

  it("shows a plain alert when the failure carries nothing raw", () => {
    state.calls = [];

    alertWithDetails("Update failed", "The update did not finish.", null);

    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]?.buttons).toBeUndefined();
  });

  it("treats whitespace-only details as nothing raw", () => {
    state.calls = [];

    alertWithDetails("Update failed", "The update did not finish.", "   ");

    expect(state.calls[0]?.buttons).toBeUndefined();
  });
});
