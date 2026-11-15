import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { QueuedMessageFailureNotice } from "./QueuedMessageFailureNotice";

/**
 * Pins the notice's drawing, not its copy: the surface, the 44-tall actions,
 * the danger action label, and the quoted line that tells two failed messages
 * apart. Dropping any of them from the component must fail here.
 */
vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");

  return {
    Pressable: (props: { className?: string; children?: ReactNode }) =>
      h("button", { className: props.className }, props.children),
    View: (props: { className?: string; children?: ReactNode }) =>
      h("div", { className: props.className }, props.children),
  };
});

vi.mock("../../components/AppText", async () => {
  const { createElement: h } = await import("react");

  return {
    AppText: (props: { className?: string; numberOfLines?: number; children?: ReactNode }) =>
      h(
        "span",
        { className: props.className, "data-lines": props.numberOfLines ?? undefined },
        props.children,
      ),
  };
});

vi.mock("../../lib/i18n", async () => {
  const { createTranslator } = await import("@isnadi/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useMobileI18n: () => ({ t: translator.translate }) };
});

function render(
  action: "block" | "discard",
  options: { readonly messageText?: string; readonly className?: string } = {},
) {
  return renderToStaticMarkup(
    <QueuedMessageFailureNotice
      className={options.className}
      failure={{ refusal: "unknown", action, at: "2026-11-15T12:00:00.000Z" }}
      messageText={options.messageText ?? "Ship the release notes"}
      onDiscard={() => {}}
      onRetry={() => {}}
    />,
  );
}

function rootClasses(markup: string): ReadonlyArray<string> {
  const first = /^<div class="([^"]*)"/.exec(markup)?.[1] ?? "";

  return first.split(" ").filter((entry) => entry.length > 0);
}

function actionClasses(markup: string): ReadonlyArray<string> {
  return [...markup.matchAll(/<button class="([^"]*)"/g)].map((match) => match[1] ?? "");
}

function classOfLabel(markup: string, label: string): string | undefined {
  return new RegExp(`<span class="([^"]*)"[^>]*>${label}</span>`).exec(markup)?.[1];
}

describe("the queued message failure notice", () => {
  it("draws the danger surface from the theme tokens", () => {
    expect(rootClasses(render("block"))).toEqual(
      expect.arrayContaining([
        "gap-1",
        "rounded-2xl",
        "border",
        "border-danger-border",
        "bg-danger",
        "pt-3",
        "px-3.5",
        "pb-1",
      ]),
    );
  });

  it("keeps the caller's own spacing alongside the surface", () => {
    expect(rootClasses(render("block", { className: "mt-2" }))).toContain("mt-2");
  });

  it("gives every action a 44-tall target while the labels stay small", () => {
    const markup = render("block");
    const actions = actionClasses(markup);

    expect(actions).toHaveLength(2);

    for (const action of actions) {
      expect(action.split(" ")).toEqual(expect.arrayContaining(["min-h-11", "justify-center"]));
    }

    expect(classOfLabel(markup, "Try again")).toContain("text-xs");
  });

  it("draws Try again as a danger action and Discard as muted", () => {
    const markup = render("block");

    expect(classOfLabel(markup, "Try again")).toContain("text-danger-foreground");
    expect(classOfLabel(markup, "Discard")).toContain("text-foreground-muted");
  });

  it("offers no retry when the person cannot fix the failure", () => {
    const markup = render("discard");

    expect(markup).not.toContain("Try again");
    expect(actionClasses(markup)).toHaveLength(1);
    expect(actionClasses(markup)[0]?.split(" ")).toEqual(
      expect.arrayContaining(["min-h-11", "justify-center"]),
    );
  });

  it("quotes the failed text on one muted line above the sentence", () => {
    const markup = render("block", { messageText: "Ship the release notes" });
    const quote = /<span class="([^"]*)" data-lines="1">([^<]*)<\/span>/.exec(markup);

    expect(quote?.[1]).toContain("text-foreground-muted");
    expect(quote?.[2]).toBe("Ship the release notes");
  });

  it("collapses a multi-line message onto the one quoted line", () => {
    const markup = render("block", { messageText: "\n  Ship the\n release notes  " });

    expect(markup).toContain(">Ship the release notes<");
  });

  it("still says why when the message text is blank", () => {
    const markup = render("block", { messageText: "   " });

    expect(markup).not.toContain('data-lines="1"');
    expect(markup).toContain("could not send your message");
  });
});
