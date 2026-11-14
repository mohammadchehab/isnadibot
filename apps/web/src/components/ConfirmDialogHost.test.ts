import { describe, expect, it } from "vite-plus/test";

import { resolveConfirmDialogCopy } from "./ConfirmDialogHost.tsx";

describe("resolveConfirmDialogCopy", () => {
  it("splits on the ASCII question mark", () => {
    expect(resolveConfirmDialogCopy('Delete "Ops"? This cannot be undone.')).toEqual({
      title: 'Delete "Ops"?',
      description: "This cannot be undone.",
    });
  });

  it("splits on the fullwidth question mark", () => {
    expect(resolveConfirmDialogCopy("删除“Ops”？此操作无法撤销。")).toEqual({
      title: "删除“Ops”？",
      description: "此操作无法撤销。",
    });
  });

  it("splits on the Arabic question mark", () => {
    // U+061F. Arabic, Persian and Urdu all end a question with it, so a class of
    // ASCII and fullwidth marks leaves the whole sentence in the title.
    expect(resolveConfirmDialogCopy("حذف «Ops»؟ لا يمكن التراجع عن هذا.")).toEqual({
      title: "حذف «Ops»؟",
      description: "لا يمكن التراجع عن هذا.",
    });
  });

  it("splits shipped Arabic copy, not just a hand-written string", () => {
    // The group-delete title verbatim from
    // packages/client-runtime/src/i18n/catalogs/ar/roster.ts, which is the copy this
    // defect was found on. Client runtime cannot import from apps/web, so this is the
    // closest a web-side test can get to the catalog suite; the test fails if either
    // the split or the shipped Arabic sentence changes shape.
    const shipped = 'حذف "{name}"؟ تبقى بوتاتها في قائمة بوتاتك.';

    expect(resolveConfirmDialogCopy(shipped)).toEqual({
      title: 'حذف "{name}"؟',
      description: "تبقى بوتاتها في قائمة بوتاتك.",
    });
  });

  it("splits a question on its own line before scanning the whole message", () => {
    expect(resolveConfirmDialogCopy("Delete it?\nThis cannot be undone.")).toEqual({
      title: "Delete it?",
      description: "This cannot be undone.",
    });
  });

  it("falls back when the message carries no question mark", () => {
    expect(resolveConfirmDialogCopy("This cannot be undone.")).toEqual({
      title: "Confirm action",
      description: "This cannot be undone.",
    });
  });
});
