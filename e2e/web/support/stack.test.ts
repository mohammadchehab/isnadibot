import { describe, expect, it } from "vite-plus/test";

import { probeOrigins, waitUntilServed } from "./stack.ts";

// Port 1 needs root to bind, so nothing on an ordinary dev box is listening there.
const CLOSED_ORIGIN = "http://localhost:1";

describe("probeOrigins", () => {
  it("probes the name and both address families it can mean for localhost", () => {
    expect(probeOrigins("http://localhost:8295")).toEqual([
      "http://localhost:8295",
      "http://[::1]:8295",
      "http://127.0.0.1:8295",
    ]);
  });

  it("leaves no dangling port separator when localhost carries the default port", () => {
    expect(probeOrigins("http://localhost")).toEqual([
      "http://localhost",
      "http://[::1]",
      "http://127.0.0.1",
    ]);
  });

  it("keeps the origin's own protocol rather than assuming http", () => {
    expect(probeOrigins("https://localhost:8295")).toEqual([
      "https://localhost:8295",
      "https://[::1]:8295",
      "https://127.0.0.1:8295",
    ]);
  });

  it("probes one origin for a literal IPv4 address", () => {
    expect(probeOrigins("http://127.0.0.1:8295")).toEqual(["http://127.0.0.1:8295"]);
  });

  it("probes one origin for a literal IPv6 address", () => {
    expect(probeOrigins("http://[::1]:8295")).toEqual(["http://[::1]:8295"]);
  });

  it("probes one origin for a remote host, whose family is not the harness's to guess", () => {
    expect(probeOrigins("http://dev-box.tailnet.example:8295")).toEqual([
      "http://dev-box.tailnet.example:8295",
    ]);
  });
});

describe("waitUntilServed", () => {
  it("names every address it tried when the stack is genuinely down", async () => {
    let message = "";

    try {
      await waitUntilServed(CLOSED_ORIGIN, 0);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain(`was not served in time; tried ${CLOSED_ORIGIN}`);
    expect(message).toContain("http://[::1]:1");
    expect(message).toContain("http://127.0.0.1:1");
  });
});
