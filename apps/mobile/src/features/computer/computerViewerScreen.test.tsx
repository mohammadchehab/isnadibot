import { renderToStaticMarkup } from "react-dom/server";
import type { ComputerFrame } from "@isnadi/contracts";
import type { ComputerViewerView } from "@isnadi/client-runtime/state/computer-viewer";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComputerViewerScreen } from "./ComputerViewerScreen";

vi.mock("react-native", () => ({ View: "View" }));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock("../../lib/useThemeColor", () => ({ useThemeColor: () => "#000000" }));

vi.mock("../../lib/i18n", () => ({
  useMobileI18n: () => ({
    t: (message: string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replaceAll(`{${key}}`, value),
        message,
      ),
  }),
}));

vi.mock("../../components/AppText", () => ({ AppText: "span" }));

vi.mock("../../components/AppSymbol", () => ({ SymbolView: () => <span /> }));

vi.mock("../../components/ControlPill", () => ({
  ControlPill: (props: { readonly label?: string }) => <button>{props.label}</button>,
}));

vi.mock("expo-image", () => ({
  Image: (props: { source: { uri: string }; cachePolicy: string }) => (
    <img src={props.source.uri} data-cache={props.cachePolicy} />
  ),
}));

const frame: ComputerFrame = {
  mimeType: "image/png",
  data: "QUJD",
  width: 1024,
  height: 640,
};

const idleView: ComputerViewerView = {
  phase: "live",
  owner: "bot",
  canTakeControl: true,
  canReturnControl: false,
  canStop: true,
  canResume: false,
  canSendInput: false,
  controlUnavailableReason: null,
};

function render(overrides: {
  readonly view?: ComputerViewerView;
  readonly showFrame?: boolean;
  readonly frame?: ComputerFrame | null;
  readonly notice?: "busy" | null;
}) {
  return renderToStaticMarkup(
    <ComputerViewerScreen
      botName="Ada"
      view={overrides.view ?? idleView}
      frame={overrides.frame === undefined ? frame : overrides.frame}
      frameKey={3}
      notice={overrides.notice ?? null}
      showFrame={overrides.showFrame ?? true}
      onTakeControl={() => {}}
      onReturnControl={() => {}}
      onResume={() => {}}
      onClose={() => {}}
    />,
  );
}

describe("ComputerViewerScreen", () => {
  it("watches without offering input, with the one way in to control", () => {
    const html = render({});

    expect(html).toContain("Ada&#x27;s screen");
    expect(html).toContain("Ada is in control");
    expect(html).toContain("Take control");
    expect(html).toContain("data:image/png;base64,QUJD");
  });

  it("offers the way back once this phone is in control", () => {
    const html = render({
      view: { ...idleView, owner: "you", canTakeControl: false, canReturnControl: true },
    });

    expect(html).toContain("You are in control");
    expect(html).toContain("Return to Ada");
    expect(html).not.toContain("Take control");
  });

  it("shows the paused screen with resume when the stream has stopped", () => {
    const html = render({
      view: { ...idleView, phase: "hidden", owner: "nobody", canTakeControl: false },
      frame: null,
    });

    expect(html).toContain("Live view paused");
    expect(html).toContain("Resume watching");
    expect(html).not.toContain("data:image/png");
  });

  it("draws no frame under the privacy cover", () => {
    const html = render({ showFrame: false });

    expect(html).not.toContain("data:image/png");
    expect(html).toContain("Live view paused");
  });

  it("says who took control when this phone lost it", () => {
    const html = render({ notice: "busy" });

    expect(html).toContain("Someone else took control first.");
  });
});
