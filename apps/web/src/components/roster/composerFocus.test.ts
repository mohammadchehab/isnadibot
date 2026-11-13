import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  claimComposerFocus,
  isComposerFocusPending,
  requestComposerFocus,
  subscribeComposerFocus,
} from "./composerFocus";

const BOT = "bot-1";

const OTHER_BOT = "bot-2";

afterEach(() => {
  claimComposerFocus(BOT);
  claimComposerFocus(OTHER_BOT);
});

describe("requestComposerFocus", () => {
  it("leaves a request the composer can claim", () => {
    requestComposerFocus(BOT);

    expect(isComposerFocusPending(BOT)).toBe(true);
    expect(isComposerFocusPending(OTHER_BOT)).toBe(false);
    expect(isComposerFocusPending(undefined)).toBe(false);
  });

  it("claims once, so a second claim finds nothing", () => {
    requestComposerFocus(BOT);

    expect(claimComposerFocus(BOT)).toBe(true);
    expect(isComposerFocusPending(BOT)).toBe(false);
    expect(claimComposerFocus(BOT)).toBe(false);
  });

  it("keeps one bot's request away from another bot's composer", () => {
    requestComposerFocus(BOT);

    expect(claimComposerFocus(OTHER_BOT)).toBe(false);
    expect(isComposerFocusPending(BOT)).toBe(true);
  });

  it("announces the request and the claim to subscribers, until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeComposerFocus(listener);

    requestComposerFocus(BOT);
    expect(listener).toHaveBeenCalledTimes(1);

    claimComposerFocus(BOT);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    requestComposerFocus(BOT);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
