import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");

  return {
    Pressable: (props: { readonly children?: ReactNode }) => h("button", null, props.children),
    View: (props: { readonly children?: ReactNode }) => h("div", null, props.children),
  };
});

vi.mock("./AppText", () => ({ AppText: "span" }));

vi.mock("../lib/i18n", async () => {
  const { createTranslator } = await import("@isnadi/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useMobileI18n: () => ({ ...translator, t: translator.translate }) };
});

import { ErrorBanner } from "./ErrorBanner";

describe("ErrorBanner", () => {
  it("shows the sentence and folds the raw cause behind a disclosure", () => {
    const markup = renderToStaticMarkup(
      createElement(ErrorBanner, {
        message: "Could not connect to this environment.",
        details: "ECONNREFUSED 127.0.0.1:8080",
      }),
    );

    expect(markup).toContain("Could not connect to this environment.");
    expect(markup).toContain("Show details");
    expect(markup).not.toContain("ECONNREFUSED");
  });

  it("shows no disclosure when the failure carries nothing raw", () => {
    const markup = renderToStaticMarkup(
      createElement(ErrorBanner, { message: "Could not connect to this environment." }),
    );

    expect(markup).toContain("Could not connect to this environment.");
    expect(markup).not.toContain("Show details");
  });
});
