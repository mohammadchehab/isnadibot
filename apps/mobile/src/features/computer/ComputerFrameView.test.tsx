import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComputerFrameView } from "./ComputerFrameView";

vi.mock("expo-image", () => ({
  Image: (props: { source: { uri: string }; cachePolicy: string; recyclingKey: string }) => (
    <img src={props.source.uri} data-cache={props.cachePolicy} data-key={props.recyclingKey} />
  ),
}));

vi.mock("react-native", () => ({ View: "View", StyleSheet: { absoluteFill: {} } }));

const frame = { mimeType: "image/png", data: "QUJD", width: 800, height: 600 } as const;

describe("ComputerFrameView", () => {
  it("never caches a frame on disk", () => {
    const html = renderToStaticMarkup(<ComputerFrameView frame={frame} frameKey={7} />);

    expect(html).toContain('data-cache="none"');
  });

  it("renders the frame as an in-memory data uri keyed by its frame count", () => {
    const html = renderToStaticMarkup(<ComputerFrameView frame={frame} frameKey={7} />);

    expect(html).toContain("data:image/png;base64,QUJD");
    expect(html).toContain('data-key="7"');
  });
});
