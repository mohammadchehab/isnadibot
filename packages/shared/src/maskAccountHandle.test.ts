import { describe, expect, it } from "vite-plus/test";

import { maskAccountHandle } from "./maskAccountHandle.ts";

describe("maskAccountHandle", () => {
  it("keeps the first letter and the domain of an email address", () => {
    expect(maskAccountHandle("mohammad@example.com")).toBe("m***@example.com");
  });

  it("masks a one-letter local part down to the mask", () => {
    expect(maskAccountHandle("m@example.com")).toBe("m***@example.com");
    expect(maskAccountHandle("mo@example.com")).toBe("m***@example.com");
  });

  it("masks an empty local part without inventing a letter", () => {
    expect(maskAccountHandle("@example.com")).toBe("***@example.com");
  });

  it("trims before masking", () => {
    expect(maskAccountHandle("  mohammad@example.com  ")).toBe("m***@example.com");
  });

  it("passes an opaque account id through unchanged", () => {
    expect(maskAccountHandle("account-123")).toBe("account-123");
    expect(maskAccountHandle("  Cursor account  ")).toBe("Cursor account");
  });

  it("splits on the last @ so a sub-address cannot leak the local part", () => {
    expect(maskAccountHandle("first.last+tag@example.com")).toBe("f***@example.com");
  });
});
