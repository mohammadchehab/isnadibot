import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "@effect/vitest";

/**
 * The invariant failure is a union: a throw either carries a refusal code, an
 * exclusion that says why no code applies, or a `pending-refusal` that names the
 * card which will mint the code. The union makes a *missing* classification a
 * compile error, so nothing here guards presence. What the types cannot see is
 * whether the registered debt is honest — a `ticket: ""` and a `reason: ""`
 * compile, and a ticket nobody holds is debt that never gets paid.
 *
 * So this ratchet guards the content of the pending arm and the shape of the
 * constructor, not the classification of each throw.
 *
 * Two deliberate departures from the wording of TASK-304's acceptance criteria:
 *
 * - The ledger scans for `pendingRefusalInvariantError(` rather than for
 *   `_tag: "pending-refusal"`. Once the union landed, that literal exists in
 *   exactly one place — the arm `Errors.ts` builds — so counting it says
 *   nothing about the throws. The factory call is what a throw actually
 *   writes, so that is what a new uncoded refusal would add. The literal is
 *   still checked, but as the separate structural guard that nobody builds the
 *   arm by hand.
 * - Its unit is a registration, not a throw. `finishedItemRejection` in
 *   `workItems.ts` serves three throws from one registration because they are
 *   one situation with one remedy; TASK-336 mints one code and drains it once.
 *   Counting throws would pin an implementation detail of a helper.
 */

const ORCHESTRATION_DIR = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

const SERVER_SOURCE_DIR = NodePath.resolve(ORCHESTRATION_DIR, "..");

const ERRORS_FILE = NodePath.join(ORCHESTRATION_DIR, "Errors.ts");

/**
 * How many pending refusals are registered today. Each one is a reachable user
 * situation with no code, and the number only goes down: a card that mints a
 * code replaces the registration with a `refused` arm and lowers this by one.
 *
 * Raising it is the wrong fix for a red test. It means a new user situation was
 * left uncoded, and the answer is a ticket on the board and a card to drain it,
 * not a bigger number here.
 */
const PENDING_REFUSAL_COUNT = 6;

/** Every TypeScript file under `apps/server/src`, tests included unless excluded. */
function sourceFiles(options: { readonly includeTests: boolean }): ReadonlyArray<string> {
  return NodeFS.readdirSync(SERVER_SOURCE_DIR, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts"))
    .filter((entry) => options.includeTests || !entry.endsWith(".test.ts"))
    .map((entry) => NodePath.join(SERVER_SOURCE_DIR, entry));
}

/**
 * `source` with comments blanked to spaces, and optionally string/template
 * literals as well, so a parenthesis or a keyword inside either cannot be
 * mistaken for code. Length is preserved, so an offset in the mask is the same
 * offset in the source. Comments are blanked either way: an apostrophe in one
 * (`thread's`) would otherwise open a "string" that blanks real code.
 *
 * A caller reading a literal's *value* passes `blankLiterals: false`. The state
 * machine still tracks the quotes, so a `//` inside a string is not read as a
 * comment.
 */
function maskSource(source: string, options: { readonly blankLiterals: boolean }): string {
  const chars = source.split("");

  const blank = (at: number) => {
    if (at < chars.length && chars[at] !== "\n") chars[at] = " ";
  };

  let quote = "";
  let state: "code" | "line" | "block" | "quote" = "code";

  for (let at = 0; at < chars.length; at += 1) {
    const char = chars[at];
    const next = chars[at + 1] ?? "";

    if (state === "code") {
      if (char === "/" && next === "/") {
        state = "line";
        blank(at);
      } else if (char === "/" && next === "*") {
        state = "block";
        blank(at);
      } else if (char === "'" || char === '"' || char === "`") {
        state = "quote";
        quote = char;

        if (options.blankLiterals) blank(at);
      }

      continue;
    }

    if (state === "line") {
      if (char === "\n") state = "code";
      else blank(at);

      continue;
    }

    if (state === "block") {
      if (char === "*" && next === "/") {
        blank(at);
        blank(at + 1);
        state = "code";
        at += 1;
      } else {
        blank(at);
      }

      continue;
    }

    if (char === "\\") {
      if (options.blankLiterals) {
        blank(at);
        blank(at + 1);
      }

      at += 1;
    } else if (char === quote) {
      if (options.blankLiterals) blank(at);

      state = "code";
    } else if (options.blankLiterals) {
      blank(at);
    }
  }

  return chars.join("");
}

/** Source with comments and literals blanked: what is left is code. */
const maskNonCode = (source: string): string => maskSource(source, { blankLiterals: true });

/** Source with only comments blanked: code and the literals inside it survive. */
const maskComments = (source: string): string => maskSource(source, { blankLiterals: false });

/** The argument text of every call to `name`, excluding the helper's own definition. */
function callArguments(source: string, name: string): ReadonlyArray<string> {
  const calls: string[] = [];
  const masked = maskNonCode(source);
  const needle = `${name}(`;

  for (
    let at = masked.indexOf(needle);
    at !== -1;
    at = masked.indexOf(needle, at + needle.length)
  ) {
    if (masked.slice(0, at).trimEnd().endsWith("function")) continue;

    const start = at + needle.length;
    let depth = 1;
    let cursor = start;

    while (cursor < masked.length && depth > 0) {
      const char = masked[cursor];

      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;

      cursor += 1;
    }

    calls.push(source.slice(start, cursor - 1));
  }

  return calls;
}

/**
 * The literal a named field is set to in a call's arguments, or `undefined` when
 * the field is absent or is not a plain literal. Keys survive masking because
 * they are identifiers; the value is read from the raw text at the offset the
 * mask preserved.
 */
function fieldLiteral(args: string, field: string): string | undefined {
  const masked = maskNonCode(args);
  const key = new RegExp(`\\b${field}:`).exec(masked);

  if (key === null) return undefined;

  const valueStart = key.index + key[0].length;
  let cursor = valueStart;

  while (cursor < args.length && /\s/.test(args[cursor] ?? "")) cursor += 1;

  const quote = args[cursor];

  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;

  let value = "";

  for (cursor += 1; cursor < args.length; cursor += 1) {
    const char = args[cursor];

    if (char === "\\") {
      value += args[cursor + 1] ?? "";
      cursor += 1;

      continue;
    }

    if (char === quote) return value;

    value += char;
  }

  return undefined;
}

/** Every `pendingRefusalInvariantError(...)` registration in shipped source. */
function pendingRefusalRegistrations(): ReadonlyArray<{
  readonly file: string;
  readonly args: string;
}> {
  return sourceFiles({ includeTests: false }).flatMap((file) =>
    callArguments(NodeFS.readFileSync(file, "utf8"), "pendingRefusalInvariantError").map(
      (args) => ({
        file: NodePath.relative(SERVER_SOURCE_DIR, file),
        args,
      }),
    ),
  );
}

describe("a pending refusal registers honest debt", () => {
  it("names the card that will mint its code, and why it needs one", () => {
    const registrations = pendingRefusalRegistrations();

    // Guard against the scan silently finding nothing: a rename of the factory
    // would otherwise turn every assertion below into a vacuous pass.
    expect(registrations.length).toBeGreaterThan(0);

    for (const { file, args } of registrations) {
      const ticket = fieldLiteral(args, "ticket");
      const reason = fieldLiteral(args, "reason");

      // The ticket is what makes the debt payable: a card number a reader can
      // look up, in the board's own format.
      expect(ticket, `${file}: pending refusal names no ticket`).toMatch(/^TASK-\d+$/);

      // The reason is what stops a later reader from re-deriving the call. An
      // empty one says "someone will think about it", which is not a reason.
      expect(
        (reason ?? "").trim().length,
        `${file}: pending refusal gives no reason`,
      ).toBeGreaterThan(0);
    }
  });

  it(`registers exactly ${PENDING_REFUSAL_COUNT} pending refusals`, () => {
    const registrations = pendingRefusalRegistrations();

    // A registration count, not a throw count: see this file's header.
    expect(
      registrations.length,
      `${registrations.length} pending refusals registered: ` +
        registrations.map(({ file }) => file).join(", "),
    ).toBe(PENDING_REFUSAL_COUNT);
  });

  it("builds the pending-refusal arm in one place only", () => {
    const builders = sourceFiles({ includeTests: false }).flatMap((file) =>
      maskComments(NodeFS.readFileSync(file, "utf8")).includes('"pending-refusal"')
        ? [NodePath.relative(SERVER_SOURCE_DIR, file)]
        : [],
    );

    // Hand-building the arm would let a throw carry a ticket that no factory
    // validates, and would make the registrations above an incomplete ledger.
    expect(builders).toEqual(["orchestration/Errors.ts"]);
  });

  it("constructs the invariant error through a named factory, never by hand", () => {
    const handBuilt = sourceFiles({ includeTests: true }).flatMap((file) =>
      NodePath.resolve(file) === NodePath.resolve(ERRORS_FILE)
        ? []
        : callArguments(
            NodeFS.readFileSync(file, "utf8"),
            "new OrchestrationCommandInvariantError",
          ).map(() => NodePath.relative(SERVER_SOURCE_DIR, file)),
    );

    // Each factory in `Errors.ts` states the situation it is for, so a reader
    // learns the vocabulary at the throw. A direct `new` skips that and picks
    // its own arm, which is how an uncoded throw gets re-introduced.
    expect(handBuilt).toEqual([]);
  });
});
