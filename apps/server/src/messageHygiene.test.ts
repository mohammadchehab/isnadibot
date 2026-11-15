import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "@effect/vitest";
import { PortabilityArchiveError } from "@isnadi/contracts";

import { memoryOperationError, portabilityError, portabilityFailure } from "./wsSupport.ts";

const SERVER_SOURCE_DIR = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

const REPO_ROOT = NodePath.resolve(SERVER_SOURCE_DIR, "../../..");

/** The three trees whose error messages a surface can print. */
const MESSAGE_GETTER_ROOTS = [
  NodePath.join(REPO_ROOT, "packages/contracts/src"),
  SERVER_SOURCE_DIR,
  NodePath.join(REPO_ROOT, "apps/desktop/src"),
] as const;

/** Path-shaped fields: a filesystem path, a config path, or a launch target. */
const PATH_SHAPED_FIELDS = ["settingsPath", "configPath", "target"] as const;

const RAW_CAUSE =
  "ENOENT: no such file or directory, open '/Users/alex/.isnadi/state/settings.json'";

const WRITTEN_SENTENCE = "IsnadiBot state changed after the preview. Review the archive again.";

/**
 * A failure sentence is read on a screen, so it says what was being done. A
 * raw cause carries filesystem paths and internal wording; it rides in `cause`
 * where a log reads it, and never reaches the message.
 */
describe("A portability failure describes the work, not the cause", () => {
  it("turns a raw cause into the operation's own sentence", () => {
    for (const [operation, sentence] of [
      ["export", "The archive could not be exported."],
      ["preview", "The archive could not be previewed."],
      ["apply", "The archive could not be applied."],
    ] as const) {
      const error = portabilityFailure(operation, new Error(RAW_CAUSE));

      expect(error.message).toBe(sentence);
      expect(error.message).not.toContain("/Users/alex");
      expect(error.operation).toBe(operation);
    }
  });

  it("keeps a sentence the caller already wrote for the user", () => {
    const written = portabilityError("apply", WRITTEN_SENTENCE);
    const error = portabilityFailure("apply", written);

    expect(error).toBe(written);
    expect(error.message).toBe(WRITTEN_SENTENCE);
  });

  it("never adopts an archive error from another operation", () => {
    const error = portabilityFailure(
      "preview",
      new PortabilityArchiveError({ operation: "apply", message: WRITTEN_SENTENCE }),
    );

    expect(error.operation).toBe("preview");
    expect(error.message).toBe("The archive could not be previewed.");
  });

  it("takes a written sentence without wrapping it", () => {
    expect(portabilityError("export", WRITTEN_SENTENCE).message).toBe(WRITTEN_SENTENCE);
  });
});

/**
 * A memory failure the store can name is a condition with its own remedy, so the
 * reason travels with it. The flattening used to drop it and leave the surface
 * with only the operation's generic sentence.
 */
describe("A memory failure keeps the condition the store named", () => {
  it("carries the reason through the flattening", () => {
    const error = memoryOperationError("document.replace", new Error(RAW_CAUSE), "memory-changed");

    expect(error.reason).toBe("memory-changed");
    expect(error.message).toBe("Memory changed since you opened it. Reopen memory before saving.");
    expect(error.message).not.toContain("/Users/alex");
    expect(error.detail).toContain("/Users/alex");
  });

  it("falls back to the operation's own sentence when no reason was named", () => {
    const error = memoryOperationError("facts.list", new Error(RAW_CAUSE));

    expect(error.reason).toBeUndefined();
    expect(error.message).toBe("The memory could not be read.");
    expect(error.message).not.toContain("/Users/alex");
  });
});

/**
 * The tripwire for the next memory handler. An authored condition is written
 * copy the user can act on, so it must name one of the closed reasons; a handler
 * that passes only the sentence falls back to the operation's generic line and
 * loses the remedy. The scan reads the source because the failing branches need
 * a store or a provider to break first.
 */
describe("No memory handler states an authored condition without a reason", () => {
  it("finds no authored sentence passed without one", () => {
    const source = NodeFS.readFileSync(
      NodePath.join(SERVER_SOURCE_DIR, "wsMemoryHandlers.ts"),
      "utf8",
    );

    expect(memoryConditionsWithoutReason(source)).toEqual([]);
  });

  it("catches a handler that drops the reason, so the scan cannot pass by accident", () => {
    const leaking = `memoryOperationError("facts.mutate", "Memory is turned off.")`;

    const clean = `memoryOperationError("facts.mutate", "Memory is turned off.", "memory-off")`;

    expect(memoryConditionsWithoutReason(leaking)).toHaveLength(1);
    expect(memoryConditionsWithoutReason(clean)).toEqual([]);
  });
});

/**
 * The tripwire for the next producer. Every account failure is shown to the
 * user as `reason`, so a producer that forwards a raw cause there reintroduces
 * the leak this suite removed. The scan reads the source rather than running
 * the handlers, because the failing branches need a provider to break first.
 */
describe("No account failure forwards a raw cause as its reason", () => {
  it("finds no producer that reads a cause into reason", () => {
    const offenders = serverSourceFiles().flatMap((file) =>
      subscriptionAuthErrorArguments(NodeFS.readFileSync(file, "utf8"))
        .filter(readsRawCause)
        .map((argument) => `${NodePath.basename(file)}: ${argument.trim()}`),
    );

    expect(offenders).toEqual([]);
  });

  it("catches a producer that reads a cause into reason, so the scan cannot pass by accident", () => {
    const leaking = `
      const fail = (cause: unknown) =>
        new SubscriptionAuthError({ reason: cause instanceof Error ? cause.message : String(cause) });
    `;

    const clean = `
      const fail = (cause: unknown) =>
        new SubscriptionAuthError({ reason: "Could not start the sign-in.", cause });
    `;

    expect(
      subscriptionAuthErrorArguments(leaking)
        .filter(readsRawCause)
        .map((argument) => argument.trim()),
    ).toHaveLength(1);
    expect(subscriptionAuthErrorArguments(clean).filter(readsRawCause)).toEqual([]);
  });

  it("every producer states a reason of its own", () => {
    const withoutReason = serverSourceFiles().flatMap((file) =>
      subscriptionAuthErrorArguments(NodeFS.readFileSync(file, "utf8"))
        .filter((argument) => !/\breason\b/.test(argument))
        .map((argument) => `${NodePath.basename(file)}: ${argument.trim()}`),
    );

    expect(withoutReason).toEqual([]);
  });
});

/**
 * The tripwire for the next error class. A message getter that interpolates a
 * path-shaped field reintroduces the leak this change removed, and it does so
 * in a file nobody thinks to check. The scan reads the source rather than the
 * classes, because a class that does not exist yet cannot be constructed, and
 * it is keyed on the getter rather than the error tag, because a tag and its
 * class disagree in at least one place. It lives here, not in the contracts
 * package, because that package carries no filesystem access of its own.
 */
describe("No error message getter interpolates a path-shaped field", () => {
  it("finds no getter that prints a path, a config path or a launch target", () => {
    const offenders = MESSAGE_GETTER_ROOTS.flatMap((root) =>
      sourceFilesUnder(root).flatMap((file) =>
        pathFieldsInMessages(NodeFS.readFileSync(file, "utf8")).map(
          (field) => `${NodePath.relative(REPO_ROOT, file)}: this.${field}`,
        ),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("catches a getter that prints a path, so the scan cannot pass by accident", () => {
    const leaking = `
      class SomeError extends Error {
        settingsPath = "/tmp/x";
        override get message(): string {
          return \`Settings failed at \${this.settingsPath}.\`;
        }
      }
    `;

    const clean = `
      class SomeError extends Error {
        settingsPath = "/tmp/x";
        override get message(): string {
          return "Settings failed.";
        }
      }
    `;

    expect(pathFieldsInMessages(leaking)).toEqual(["settingsPath"]);
    expect(pathFieldsInMessages(clean)).toEqual([]);
  });
});

function serverSourceFiles(): ReadonlyArray<string> {
  return sourceFilesUnder(SERVER_SOURCE_DIR);
}

/** Every non-test TypeScript source file under a directory, at any depth. */
function sourceFilesUnder(directory: string): ReadonlyArray<string> {
  return NodeFS.readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .map((entry) => NodePath.join(directory, entry));
}

/** Every path-shaped field a file's `get message()` bodies read off `this`. */
function pathFieldsInMessages(source: string): ReadonlyArray<string> {
  const fields = new Set<string>();

  for (const body of messageGetterBodies(source)) {
    for (const field of PATH_SHAPED_FIELDS) {
      if (new RegExp(`\\bthis\\.${field}\\b`).test(body)) {
        fields.add(field);
      }
    }
  }

  return [...fields];
}

/** The body of every `get message()` in a source file. */
function messageGetterBodies(source: string): ReadonlyArray<string> {
  const bodies: string[] = [];
  const getter = /get message\(\)\s*:\s*string\s*\{/g;

  for (let match = getter.exec(source); match !== null; match = getter.exec(source)) {
    const open = match.index + match[0].length - 1;

    bodies.push(blockAt(source, open));
  }

  return bodies;
}

/** The text between the brace at `open` and the brace that closes it. */
function blockAt(source: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;

  for (let index = open; index < source.length; index += 1) {
    const character = source[index];

    if (quote !== null) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;

      continue;
    }

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }

  return source.slice(open + 1);
}

/** The argument of every `new SubscriptionAuthError(...)` in a source file. */
function subscriptionAuthErrorArguments(source: string): ReadonlyArray<string> {
  const arguments_: string[] = [];
  const constructor = /new SubscriptionAuthError\(/g;

  for (let match = constructor.exec(source); match !== null; match = constructor.exec(source)) {
    arguments_.push(argumentAt(source, match.index + match[0].length - 1));
  }

  return arguments_;
}

/** The authored condition of every `memoryOperationError` call that names no reason. */
function memoryConditionsWithoutReason(source: string): ReadonlyArray<string> {
  const offenders: string[] = [];
  const call = /memoryOperationError\(/g;

  for (let match = call.exec(source); match !== null; match = call.exec(source)) {
    const [operation, condition, reason] = topLevelArguments(
      argumentAt(source, match.index + match[0].length - 1),
    );

    // A plain string literal is copy someone wrote for this condition. Any other
    // second argument is the cause itself, whose sentence already comes from the
    // operation.
    if (condition === undefined || !/^\s*"/.test(condition)) continue;

    if (reason !== undefined && reason.trim().length > 0) continue;

    offenders.push(`${operation?.trim() ?? ""}, ${condition.trim()}`);
  }

  return offenders;
}

/** Split an argument list on the commas outside a nested call, string or template. */
function topLevelArguments(text: string): ReadonlyArray<string> {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quote !== null) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (character === "(" || character === "[" || character === "{") {
      depth += 1;
    } else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(text.slice(start));

  return parts.filter((part) => part.trim().length > 0);
}

/** Whether a producer builds its reason from the cause it was handed. */
function readsRawCause(argument: string): boolean {
  return (
    /\bcause\s*\.\s*message\b/.test(argument) ||
    /\binstanceof\s+Error\b/.test(argument) ||
    /\bString\s*\(\s*cause\b/.test(argument) ||
    /\bcause\s*\.\s*stack\b/.test(argument)
  );
}

/** The text between the parenthesis at `open` and the parenthesis that closes it. */
function argumentAt(source: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;

  for (let index = open; index < source.length; index += 1) {
    const character = source[index];

    if (quote !== null) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;

      continue;
    }

    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(open + 1, index);
      }
    }
  }

  return source.slice(open + 1);
}
