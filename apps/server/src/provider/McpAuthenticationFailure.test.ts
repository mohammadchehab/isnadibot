import { describe, expect, it } from "vite-plus/test";

import { describeMcpAuthenticationFailure } from "./McpAuthenticationFailure.ts";

const registrationRejection =
  'Dynamic Client Registration rejected (HTTP 400): {"error":"invalid_client_metadata","error_description":"Maximum 10 redirect_uris allowed"}';

describe("MCP authentication failure", () => {
  it("repeats the authorization server's own reason for a refused registration", () => {
    expect(describeMcpAuthenticationFailure(new Error(registrationRejection))).toBe(
      "The authorization server refused to register IsnadiBot (HTTP 400): Maximum 10 redirect_uris allowed",
    );
  });

  it("names the refusal when the authorization server sends no description", () => {
    expect(
      describeMcpAuthenticationFailure(
        new Error('Dynamic Client Registration rejected (HTTP 403): {"error":"access_denied"}'),
      ),
    ).toBe("The authorization server refused to register IsnadiBot (HTTP 403).");
  });

  it("still reads the rejection through the controller's wrapper", () => {
    expect(
      describeMcpAuthenticationFailure(
        new Error(`AgentController failed in mcp.authenticate: ${registrationRejection}`),
      ),
    ).toBe(
      "The authorization server refused to register IsnadiBot (HTTP 400): Maximum 10 redirect_uris allowed",
    );
  });

  it("keeps the reachability sentence for a server that never answered", () => {
    expect(
      describeMcpAuthenticationFailure(
        new Error("Could not connect to server with any available HTTP transport"),
      ),
    ).toBe("The MCP server could not be reached.");
  });

  it("keeps the reachability sentence for a cause that is not an error", () => {
    expect(describeMcpAuthenticationFailure("cancelled")).toBe(
      "The MCP server could not be reached.",
    );
  });
});
