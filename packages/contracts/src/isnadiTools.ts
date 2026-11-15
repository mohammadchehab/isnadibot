import type { decodeIsnadiToolInput } from "./isnadiTools/inputs.ts";
import * as Predicate from "effect/Predicate";
import {
  ISNADI_DELEGATION_MAX_CONCURRENCY,
  ISNADI_DELEGATION_MAX_DEPTH,
} from "./isnadiDelegation.ts";
import { ISNADI_WORKER_MAX_DEPTH } from "./isnadiWorkers.ts";
import {
  IsnadiToolId,
  IsnadiToolApprovalClass,
  IsnadiProtectedApprovalClass,
  ISNADI_PROTECTED_APPROVAL_CLASSES,
  IsnadiToolCapability,
  IsnadiToolWorkspaceType,
  type IsnadiCopyDirection,
  type IsnadiToolDefinition,
  ISNADI_TOOL_CATALOG,
} from "./isnadiTools/catalog.ts";

export interface IsnadiToolAvailabilityContext {
  readonly capabilities: ReadonlySet<IsnadiToolCapability>;
  readonly workspaceType: IsnadiToolWorkspaceType;
  readonly hasUserComputer: boolean;
  readonly localFullAccess: boolean;
  readonly implementedTools: ReadonlySet<string>;
  readonly delegationDepth?: number;
  readonly activeDelegations?: number;
  /** 0 for a bot turn, 1 inside a temporary worker. */
  readonly workerDepth?: number;
}

export function filterIsnadiTools(
  context: IsnadiToolAvailabilityContext,
): ReadonlyArray<IsnadiToolDefinition> {
  return ISNADI_TOOL_CATALOG.filter((tool) => {
    if (!context.capabilities.has(tool.capability)) return false;

    if (!context.implementedTools.has(tool.id)) return false;

    if (
      (tool.id === "SendToAgent" || tool.id === "MessageAgent") &&
      ((context.delegationDepth ?? 0) >= ISNADI_DELEGATION_MAX_DEPTH ||
        (context.activeDelegations ?? 0) >= ISNADI_DELEGATION_MAX_CONCURRENCY)
    )
      return false;

    if (tool.id === "Task" && (context.workerDepth ?? 0) >= ISNADI_WORKER_MAX_DEPTH) return false;

    if (tool.workspace === "bot-workspace" && context.workspaceType === "none") return false;

    if (tool.workspace === "user-computer" && !context.hasUserComputer) return false;

    return !(tool.requiresUserComputer && !context.hasUserComputer);
  });
}

export function classifyIsnadiSensitivePath(
  path: string,
): IsnadiProtectedApprovalClass | undefined {
  return /(^|[/\\])(?:\.env(?:\.[^/\\]+)?|\.ssh|\.aws|\.config[/\\]gh|keychain|credentials?|secrets?|tokens?)(?:[/\\]|$)/i.test(
    path,
  )
    ? "secrets"
    : undefined;
}

/**
 * The delimiter after a `<<` that has already been established as an operator,
 * in every form the shell accepts: `<<EOF`, `<<-EOF` (tab-stripped), `<<'EOF'`,
 * `<<"EOF"`, `<<\EOF` and `<< 'EOF'`. Anchored so it matches only at the `<<`.
 */
const HEREDOC_DELIMITER =
  /^<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|\\([A-Za-z_][\w-]*)|([A-Za-z_][\w-]*))/;

/** Characters after which a `#` starts a comment rather than a literal `#`. */
const WORD_BOUNDARY = /[\s;&|()<>]/;

type QuoteState = "'" | '"' | null;

interface HeredocOpener {
  readonly stripLeadingTabs: boolean;
  readonly delimiter: string;
}

/** An arithmetic region the shell is still inside when a line ends. */
interface ArithmeticRegion {
  readonly kind: "paren" | "bracket";
  /** Closers still owed: `$[a[1]` owes two, so a nested subscript is not the end. */
  readonly depth: number;
}

/** What one line tells the next: the heredoc it opens, and any quote or arithmetic region left open. */
interface HeredocScan {
  readonly opener: HeredocOpener | null;
  readonly quote: QuoteState;
  readonly arithmetic: ArithmeticRegion | null;
}

/** Where an arithmetic scan stopped, and the closers it still owes. */
interface ArithmeticScan {
  /** The index just past the closer, or `line.length` when the region runs on. */
  readonly next: number;
  readonly depth: number;
}

/**
 * The index just past the `)` that closes the parenthesised group the scan
 * starts in, so an arithmetic region is skipped as one unit. `startingDepth` is
 * the closers already owed when the line begins inside a region a previous line
 * opened; zero starts at the opening paren. A group still open when the line
 * ends returns the depth it owes, because the shell keeps reading on the next
 * line rather than ending the region there.
 */
const scanArithmeticParens = (line: string, at: number, startingDepth: number): ArithmeticScan => {
  let depth = startingDepth;

  for (let cursor = at; cursor < line.length; cursor += 1) {
    const char = line[cursor];

    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;

      if (depth <= 0) return { next: cursor + 1, depth: 0 };
    }
  }

  return { next: line.length, depth };
};

/**
 * The same scan for `$[…]`, counting brackets instead of taking the first `]`.
 * A nested subscript such as `$[a[1] << k]` is one region, so the `]` that
 * closes `a[1]` does not end it and leave the `<<` looking like an opener.
 */
const scanBracketArithmetic = (line: string, at: number, startingDepth: number): ArithmeticScan => {
  let depth = startingDepth;

  for (let cursor = at; cursor < line.length; cursor += 1) {
    const char = line[cursor];

    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;

      if (depth <= 0) return { next: cursor + 1, depth: 0 };
    }
  }

  return { next: line.length, depth };
};

/**
 * The heredoc opener on one line, if the shell would read one, plus the quote
 * and arithmetic state the line leaves open for the next line. A `<<` inside a
 * quoted string, inside a `#` comment, opening a `<<<` herestring, or sitting in
 * an arithmetic region (`$((…))`, `((…))`, `$[…]`) where it is a shift is not an
 * operator, so it opens nothing — the shell runs every line after it, and so
 * must we. An arithmetic region may open on one line and close on a later one,
 * so the region a line ends inside is carried the way a quote is.
 *
 * `null` means the line leaves the subset this scanner models, and the caller
 * must strip nothing at all: `${…}`, `$'…'`, `$"…"` and `$(…)` are regions whose
 * text this scanner does not read, a backtick is command substitution it does
 * not track, a line continued by a trailing backslash is not a whole line, and a
 * `<<` whose delimiter is not a literal word has no terminator this scanner can
 * find. In every one of those, a `<<` may or may not be an operator, and reading
 * it as one deletes text the shell would run. Enumerating the regions instead
 * loses this one construct per review round; refusing to guess does not.
 */
const scanHeredocOpener = (
  line: string,
  startingQuote: QuoteState,
  startingArithmetic: ArithmeticRegion | null,
): HeredocScan | null => {
  let quote = startingQuote;
  let atWordStart = true;
  let at = 0;

  // A region a previous line opened is resumed before anything else is read:
  // up to its closer the line is arithmetic, where a `<<` is a shift.
  if (startingArithmetic !== null) {
    const resumed =
      startingArithmetic.kind === "paren"
        ? scanArithmeticParens(line, 0, startingArithmetic.depth)
        : scanBracketArithmetic(line, 0, startingArithmetic.depth);

    if (resumed.depth > 0) {
      return {
        opener: null,
        quote,
        arithmetic: { kind: startingArithmetic.kind, depth: resumed.depth },
      };
    }

    at = resumed.next;
    atWordStart = false;
  }

  for (; at < line.length; at += 1) {
    const char = line[at] ?? "";

    if (quote === "'") {
      if (char === "'") quote = null;

      continue;
    }

    if (char === "\\") {
      // A trailing backslash continues the command on the next line, so this
      // line is not a line the shell reads on its own: the scan would look for a
      // heredoc in the wrong place.
      if (at + 1 >= line.length) return null;

      // A backslash escapes the next character inside double quotes as well as
      // outside them, which is enough to stop `\"` closing a string and `\<`
      // opening a heredoc.
      at += 1;
      atWordStart = false;

      continue;
    }

    if (quote === '"') {
      if (char === '"') quote = null;

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      atWordStart = false;

      continue;
    }

    if (char === "#" && atWordStart) {
      // A `#` that starts a word comments out the rest of the line, so a `<<` in
      // it is text the shell never reads as an operator.
      return { opener: null, quote, arithmetic: null };
    }

    if (char === "`") {
      // Backticks are command substitution, a region this scanner does not
      // track, so it cannot say whether a `<<` inside one is an operator.
      return null;
    }

    // `<<` inside an arithmetic region is a shift operator, not a heredoc
    // opener. Skip the whole region so its contents are never read as shell
    // operators, in every form the shell accepts: `$((…))`, `((…))` and `$[…]`.
    // A region still open at the end of the line is carried to the next one.
    if (char === "$" && line[at + 1] === "(" && line[at + 2] === "(") {
      const region = scanArithmeticParens(line, at + 1, 0);

      if (region.depth > 0)
        return { opener: null, quote, arithmetic: { kind: "paren", depth: region.depth } };

      at = region.next - 1;
      atWordStart = false;

      continue;
    }

    if (char === "(" && line[at + 1] === "(") {
      const region = scanArithmeticParens(line, at, 0);

      if (region.depth > 0)
        return { opener: null, quote, arithmetic: { kind: "paren", depth: region.depth } };

      at = region.next - 1;
      atWordStart = false;

      continue;
    }

    if (char === "$" && line[at + 1] === "[") {
      const region = scanBracketArithmetic(line, at + 1, 0);

      if (region.depth > 0)
        return { opener: null, quote, arithmetic: { kind: "bracket", depth: region.depth } };

      at = region.next - 1;
      atWordStart = false;

      continue;
    }

    if (char === "$") {
      const next = line[at + 1] ?? "";

      // `$((…))` and `$[…]` were read above, where arithmetic makes a `<<` a
      // shift. Every other `$` that opens a region — `${…}` parameter
      // expansion, `$'…'` ANSI-C quoting, `$"…"` locale quoting, `$(…)` command
      // substitution — is text this scanner does not read, so a `<<` inside it
      // cannot be placed. A bare `$` prefix such as `$HOME` opens nothing.
      if (next === "{" || next === "'" || next === '"' || next === "(") return null;
    }

    if (char === "<" && line[at + 1] === "<") {
      if (line[at + 2] === "<") {
        // `<<<` is a herestring: the word after it is data, not a delimiter.
        at += 2;
        atWordStart = false;

        continue;
      }

      const match = HEREDOC_DELIMITER.exec(line.slice(at));
      const delimiter = match?.[2] ?? match?.[3] ?? match?.[4] ?? match?.[5];

      if (match === null || delimiter === undefined) {
        // A `<<` whose delimiter is not a literal word — `<<$DELIM`, `<<` at the
        // end of a line — opens a heredoc whose terminator this scanner cannot
        // find, so it cannot tell body from command.
        return null;
      }

      return {
        opener: { stripLeadingTabs: match[1] === "-", delimiter },
        quote,
        arithmetic: null,
      };
    }

    atWordStart = WORD_BOUNDARY.test(char);
  }

  return { opener: null, quote, arithmetic: null };
};

/**
 * `command` with the body of every *terminated* heredoc removed, so the text a
 * script writes or prints is not read as the command's intent. A README body
 * that says "delete a todo" is content, not a destructive command.
 *
 * Only a `<<` the shell reads as an operator opens a heredoc. A phantom opener
 * in a quoted string, a `#` comment, a herestring, or an arithmetic region
 * (`$((…))`, `((…))`, `$[…]`) where `<<` is a shift would otherwise drop every
 * line up to a later line equal to its "delimiter" from classification, which
 * is a way to run a destructive command with no approval prompt at all. An
 * arithmetic region may span lines, so the one a line ends inside is carried to
 * the next; a line inside it never opens a heredoc.
 *
 * An unterminated heredoc is left whole on purpose. It swallows the rest of the
 * command, so stripping what follows a stray opener would hide a real
 * destructive command behind it; keeping it means a false protection at worst,
 * never a missed one.
 *
 * The same rule decides the whole command, and it is the reason this function
 * cannot lose a command to a construct nobody thought of: a body is stripped
 * only when *every* line is in the subset `scanHeredocOpener` models and every
 * opener it finds is terminated. Anything else — a region the scanner does not
 * read, a quote or arithmetic region still open at the end, an opener with no
 * terminator — returns the command untouched, so classification sees the text
 * the shell would run. Over-classifying costs a prompt; under-classifying costs
 * the approval.
 */
export function stripHeredocBodies(command: string): string {
  const lines = command.split("\n");
  const kept: string[] = [];
  let quote: QuoteState = null;
  let arithmetic: ArithmeticRegion | null = null;

  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] ?? "";
    kept.push(line);

    const scan = scanHeredocOpener(line, quote, arithmetic);

    // A line the scanner cannot read leaves the whole command unstripped.
    if (scan === null) return command;

    quote = scan.quote;
    arithmetic = scan.arithmetic;

    if (scan.opener === null) continue;

    const { delimiter, stripLeadingTabs } = scan.opener;

    const isTerminator = (candidate: string) => {
      const withoutTabs = stripLeadingTabs ? candidate.replace(/^\t+/, "") : candidate;

      return withoutTabs.replace(/\r$/, "") === delimiter;
    };

    // Locate the terminator before dropping anything: no terminator means the
    // heredoc runs to the end of the command and every later line is its body.
    let terminator = -1;

    for (let cursor = at + 1; cursor < lines.length; cursor += 1) {
      if (isTerminator(lines[cursor] ?? "")) {
        terminator = cursor;
        break;
      }
    }

    // No terminator means every later line is body the shell never runs, but
    // this scanner cannot prove where that body ends, so it strips nothing.
    if (terminator === -1) return command;

    // The opener stays, the body and its terminator go, and scanning resumes
    // after the terminator so a command on the next line is still classified.
    at = terminator;
  }

  // A quote or arithmetic region still open when the command ends is a command
  // the shell reads past its last line, so no line was read in the right place.
  if (quote !== null || arithmetic !== null) return command;

  return kept.join("\n");
}

export function classifyIsnadiExternalCommand(
  command: string,
): IsnadiProtectedApprovalClass | undefined {
  const intent = stripHeredocBodies(command);

  if (/\b(stripe|checkout|payment|purchase|buy)\b/i.test(intent)) return "pay";

  if (/\b(rm|rmdir|unlink|trash|delete|drop|destroy|wipe)\b/i.test(intent)) return "delete";

  if (/\b(secret|credential|token|password|keychain|\.env)\b/i.test(intent)) return "secrets";

  if (
    /\b(deploy|release|publish|production|kubectl|terraform\s+apply|git\s+push|gh\s+pr\s+(?:create|merge))\b/i.test(
      intent,
    )
  )
    return "production";

  if (
    /\b(send|post|comment|message|mail|curl\b[^\n]*(?:-X\s*POST|--request\s+POST|-d\b|--data(?:-raw|-binary|-urlencode)?\b))\b/i.test(
      intent,
    )
  )
    return "send";

  return undefined;
}

export function isnadiToolApprovalForInput(
  tool: IsnadiToolDefinition,
  input: Parameters<typeof decodeIsnadiToolInput>[1],
  context?: { readonly workspaceType?: IsnadiToolWorkspaceType },
): IsnadiToolApprovalClass {
  if (!Predicate.isObjectOrArray(input)) return tool.approval;

  if (
    (tool.id === "Shell" || tool.id === "ExternalShell") &&
    "command" in input &&
    Predicate.isString(input.command)
  ) {
    const protectedClass = classifyIsnadiExternalCommand(input.command);

    if (protectedClass) return protectedClass;
  }

  if (tool.id === "ExternalRead" && "path" in input && Predicate.isString(input.path)) {
    return classifyIsnadiSensitivePath(input.path) ?? tool.approval;
  }

  if (tool.id === "CopyToBox" && "sourcePath" in input && Predicate.isString(input.sourcePath)) {
    return classifyIsnadiSensitivePath(input.sourcePath) ?? tool.approval;
  }

  if (tool.id === "CopyFromBox" && "sourcePath" in input && Predicate.isString(input.sourcePath)) {
    return classifyIsnadiSensitivePath(input.sourcePath) ?? tool.approval;
  }

  if (tool.id === "Shell" && context?.workspaceType === "local") return "user-computer";

  return tool.approval;
}

export function isnadiToolRequiresApproval(
  tool: IsnadiToolDefinition,
  context: Pick<IsnadiToolAvailabilityContext, "localFullAccess"> & {
    readonly workspaceType?: IsnadiToolWorkspaceType;
    /**
     * True when a bot-to-bot handoff's target shares a space with the calling
     * bot, for both `SendToAgent` and `MessageAgent`. The caller resolves it
     * because only the caller holds the session and so the environment: neither
     * bot is visible from here, and the ids in `input` mean nothing without a
     * read model to look them up in.
     */
    readonly sameSpaceTarget?: boolean;
  },
  input?: Parameters<typeof decodeIsnadiToolInput>[1],
): boolean {
  const approval = isnadiToolApprovalForInput(tool, input, context);

  if (tool.id === "Shell" && context.workspaceType === "local") return true;

  // A handoff between two bots in one space crosses nothing the user has not
  // already agreed to: they hired both bots and made one of them the boss. The
  // delegation record is its audit trail, so it is recorded rather than
  // approved. Anything that leaves the space keeps the approval it had.
  //
  // Same-space handoff is keyed on the shared home, not on who created the bot:
  // the boundary is the space the user made, so a bot another bot spawned inside
  // that space is inside it. Gating a bot that makes bots belongs on CreateAgent,
  // not on the delegation.
  if ((tool.id === "SendToAgent" || tool.id === "MessageAgent") && context.sameSpaceTarget === true)
    return false;

  if (
    Array.from(ISNADI_PROTECTED_APPROVAL_CLASSES).some(
      (protectedClass) => protectedClass === approval,
    )
  )
    return true;

  return approval === "user-computer" && !(context.localFullAccess && input !== undefined);
}

export function copyDirectionForTool(toolId: IsnadiToolId): IsnadiCopyDirection | undefined {
  return ISNADI_TOOL_CATALOG.find((tool) => tool.id === toolId)?.copy;
}

export {
  ISNADI_COMMAND_MAX_CHARS,
  ISNADI_PATH_MAX_CHARS,
  IsnadiAwaitHandleId,
  IsnadiPluginRecommendation,
  IsnadiPluginSearchResult,
  IsnadiComputerBoundary,
  ISNADI_DELEGATION_CONTEXT_MAX_CHARS,
  IsnadiToolInputSchemas,
  IsnadiMessageReactionResult,
  decodeIsnadiToolInput,
} from "./isnadiTools/inputs.ts";

export {
  IsnadiToolId,
  IsnadiToolApprovalClass,
  IsnadiProtectedApprovalClass,
  ISNADI_PROTECTED_APPROVAL_CLASSES,
  IsnadiToolCapability,
  IsnadiToolWorkspaceType,
  type IsnadiToolWorkspaceRequirement,
  type IsnadiCopyDirection,
  type IsnadiToolDefinition,
  ISNADI_TOOL_CATALOG,
  ISNADI_TOOL_IDS,
} from "./isnadiTools/catalog.ts";

export {
  IsnadiToolReceiptPhase,
  IsnadiToolFailureCode,
  IsnadiToolReceipt,
} from "./isnadiTools/receipts.ts";
