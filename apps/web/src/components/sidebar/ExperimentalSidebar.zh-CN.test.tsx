import { catalogRegistry } from "@isnadi/client-runtime/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { LanguageProvider } from "../../i18n";

vi.mock("@tanstack/react-router", () => ({
  useLocation: ({ select }: { select: (location: { pathname: string }) => string }) =>
    select({ pathname: "/settings/general" }),
  useNavigate: () => () => undefined,
}));

vi.mock("../../state/entities", () => ({ useDecisions: () => [] }));

vi.mock("../../state/environments", () => ({ usePrimaryEnvironmentId: () => null }));

// The rows are the real primitives; only the provider context is faked, because
// this renders the sidebar on its own.
vi.mock("../ui/sidebarContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ui/sidebarContext")>()),
  useSidebar: () => ({
    isMobile: false,
    state: "expanded",
    toggleSidebar: () => undefined,
  }),
}));

import { ExperimentalSidebar } from "./ExperimentalSidebar";

const zhCNCatalog = await catalogRegistry["zh-CN"]!();

describe("experimental sidebar in Simplified Chinese", () => {
  it("translates every row and the collapse control", () => {
    const html = renderToStaticMarkup(
      <LanguageProvider testCatalog={{ locale: "zh-CN", catalog: zhCNCatalog }}>
        <ExperimentalSidebar />
      </LanguageProvider>,
    );

    expect(html).toContain('aria-label="主导航"');
    expect(html).toContain('aria-label="收起侧边栏"');

    for (const label of ["聊天", "例行任务", "插件", "待决事项", "设置"]) {
      expect(html).toContain(`>${label}</span>`);
    }

    expect(html).not.toContain("Chats");
    expect(html).not.toContain("Decisions");
  });
});
