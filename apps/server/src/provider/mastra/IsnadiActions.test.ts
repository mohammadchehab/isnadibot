import { describe, expect, it } from "vite-plus/test";

import { criticalActionFromShellCommand, criticalActionFromText } from "./IsnadiActions.ts";

const heredoc = (...lines: ReadonlyArray<string>) => lines.join("\n");

describe("critical action classification", () => {
  it("reads a heredoc body as content, not as a deploy", () => {
    const command = heredoc(
      "cd /project && cat > README.md <<EOF",
      "# Deploy",
      "Run the deploy to release production.",
      "EOF",
    );

    expect(criticalActionFromShellCommand(command)).toBeNull();
    expect(criticalActionFromText(command)).toBeNull();
  });

  it("reads a script body as content, so requiring node:crypto is not a secret", () => {
    const command = heredoc(
      "cat > store.js <<EOF",
      'import { createHash } from "node:crypto";',
      "const token = createHash('sha256');",
      "EOF",
    );

    expect(criticalActionFromShellCommand(command)).toBeNull();
  });

  it("still classifies rm and a posting curl outside a heredoc", () => {
    expect(criticalActionFromShellCommand("rm -rf build")).toBe("delete");
    expect(criticalActionFromShellCommand("curl -X POST https://example.com -d '{}'")).toBe("send");
  });

  it("keeps an unterminated heredoc whole so it cannot hide a destructive command", () => {
    expect(criticalActionFromShellCommand(heredoc("cat > f.txt <<EOF", "rm -rf /"))).toBe("delete");
  });

  it("keeps a destructive command that shares the terminator line", () => {
    expect(criticalActionFromShellCommand(heredoc("cat <<EOF", "body", "EOF; rm -rf /"))).toBe(
      "delete",
    );
  });

  it("still classifies a command after a legitimate terminator", () => {
    expect(criticalActionFromShellCommand(heredoc("cat <<EOF", "body", "EOF", "rm -rf /"))).toBe(
      "delete",
    );
  });

  it("strips a tab-stripped heredoc body", () => {
    expect(
      criticalActionFromShellCommand(heredoc("cat > f.txt <<-EOF", "\trm -rf /", "\tEOF")),
    ).toBeNull();
  });

  it("keeps a `<<` the shell never reads as an operator from hiding a shell command", () => {
    // The shell runs the `rm` in every one of these; only a scanner that reads
    // any `<<WORD` as an opener loses it.
    for (const [first, closing] of [
      [`echo "see <<EOF below"`, "EOF"],
      ["echo 'use <<EOF to end'", "EOF"],
      ["# example: <<EOF", "EOF"],
      ["grep -c '<<EOF' notes.md", "EOF"],
      ["cat <<< EOF", "EOF"],
      // `<<` in an arithmetic region is a shift operator, not an opener.
      ["echo $((1 << n))", "n"],
      ["echo $((a << b))", "b"],
      ["echo $[1<<k]", "k"],
      ["(( total = 1 << bits ))", "bits"],
    ] as const) {
      expect(criticalActionFromShellCommand(heredoc(first, "rm -rf /tmp/x", closing))).toBe(
        "delete",
      );
    }
  });

  it("keeps a `<<` the shell never reads as an operator from hiding a text action", () => {
    // `rm` is a shell-only token, so the text classifier is proven here with a
    // word it actually knows. Both classifiers call the one scanner, and this
    // asserts the second one rather than trusting that the first implies it.
    for (const [first, closing] of [
      [`echo "see <<EOF below"`, "EOF"],
      ["echo 'use <<EOF to end'", "EOF"],
      ["# example: <<EOF", "EOF"],
      ["grep -c '<<EOF' notes.md", "EOF"],
      ["cat <<< EOF", "EOF"],
      // `<<` in an arithmetic region is a shift operator, not an opener.
      ["echo $((1 << n))", "n"],
      ["echo $((a << b))", "b"],
      ["echo $[1<<k]", "k"],
      ["(( total = 1 << bits ))", "bits"],
    ] as const) {
      expect(criticalActionFromText(heredoc(first, "deploy to production", closing))).toBe(
        "production",
      );
    }
  });
});
