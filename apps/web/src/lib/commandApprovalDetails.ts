import { type PendingApproval } from "@isnadi/client-runtime/pending-requests";
import { isFileWriteRedirection, parseShellCommands, programOf } from "@isnadi/contracts";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { storedField } from "./persistedSchema";
import * as Predicate from "effect/Predicate";

/**
 * Facts about a pending command approval that the collapsed row cannot show.
 * The approval panel opens its details section only when one of these is present,
 * so a bare command such as "pwd" never offers an expander that repeats itself.
 */
export interface CommandApprovalDetails {
  readonly command: string;
  readonly workingDirectory: string | null;
  readonly reason: string | null;
  readonly programs: ReadonlyArray<string>;
  readonly signals: ReadonlyArray<string>;
  /** True when the collapsed row already shows every character, so expanding must not repeat it. */
  readonly fitsCollapsedRow: boolean;
  readonly hasDetails: boolean;
}

/** Longer than this and the collapsed row truncates, so the full text is worth expanding. */
const TRUNCATING_COMMAND_LENGTH = 64;

/** Programs whose command position is the fact a reviewer needs, whatever their arguments. */
const DELETES_FILES = new Set(["rm", "rmdir", "unlink", "trash"]);

const REACHES_NETWORK = new Set(["curl", "wget", "ssh", "scp", "nc", "rsync"]);

const CHANGES_PERMISSIONS = new Set(["chmod", "chown"]);

/** The subcommand that publishes, per program: `git push`, `npm publish`, and their peers. */
const PUBLISHES = new Map([
  ["git", "push"],
  ["npm", "publish"],
  ["bun", "publish"],
  ["pnpm", "publish"],
  ["yarn", "publish"],
]);

function readString(
  args: CommandApprovalArguments | null,
  keys: ReadonlyArray<keyof CommandApprovalArguments>,
): string | null {
  for (const key of keys) {
    const value = args?.[key];

    if (Predicate.isString(value) && value.trim().length > 0) return value.trim();
  }

  return null;
}

/**
 * The programs a command runs, in order, from the same shell parse the signals use. One
 * parse means a quoted separator (`echo "a; b"`) cannot invent a second program.
 */
function programsOf(command: string): ReadonlyArray<string> {
  const seen: string[] = [];

  for (const segment of parseShellCommands(command)) {
    const { program } = programOf(segment);

    if (program && !seen.includes(program)) seen.push(program);
  }

  return seen;
}

/** The first argument that is not a flag: `git push` and `npm publish` read as publishes. */
function subcommandOf(args: ReadonlyArray<string>): string | null {
  return args.find((argument) => !argument.startsWith("-")) ?? null;
}

/**
 * Short labels for the operations a reviewer needs to see before approving.
 *
 * Every label is a projection of the one shell parse: a program counts only where the
 * shell would run it, and a write counts only when the redirection targets a real file.
 * A second regex pass over the raw string cannot make either distinction — it reads the
 * `git push` inside `grep "git push" log` as a push and `2>&1` as a file write.
 */
function signalsOf(command: string): ReadonlyArray<string> {
  const signals: string[] = [];

  const add = (label: string) => {
    if (!signals.includes(label)) signals.push(label);
  };

  const segments = parseShellCommands(command);
  const commands = segments.map((segment) => programOf(segment));

  if (commands.some(({ wrappers }) => wrappers.includes("sudo"))) add("Runs as root");

  if (commands.some(({ program }) => program !== null && DELETES_FILES.has(program))) {
    add("Deletes files");
  }

  if (commands.some(({ program }) => program !== null && REACHES_NETWORK.has(program))) {
    add("Network access");
  }

  if (
    commands.some(({ program, args }) => {
      const publishes = program === null ? undefined : PUBLISHES.get(program);

      return publishes !== undefined && subcommandOf(args) === publishes;
    })
  ) {
    add("Publishes");
  }

  const writes =
    commands.some(({ program }) => program === "tee") ||
    segments.some((segment) =>
      segment.redirections.some((redirection) => isFileWriteRedirection(redirection)),
    );

  if (writes) add("Writes files");

  if (commands.some(({ program }) => program !== null && CHANGES_PERMISSIONS.has(program))) {
    add("Changes permissions");
  }

  return signals;
}

const optionalArgument = storedField(Schema.NullOr(Schema.String), null);

const CommandApprovalArguments = Schema.Struct({
  cwd: optionalArgument,
  workdir: optionalArgument,
  working_directory: optionalArgument,
  workingDirectory: optionalArgument,
  justification: optionalArgument,
  reason: optionalArgument,
  explanation: optionalArgument,
  purpose: optionalArgument,
});

type CommandApprovalArguments = typeof CommandApprovalArguments.Type;

const decodeApprovalArguments = Schema.decodeUnknownOption(CommandApprovalArguments);

export function describeCommandApproval(
  command: string,
  args: PendingApproval["args"],
): CommandApprovalDetails {
  const record = Option.getOrNull(decodeApprovalArguments(args));

  const workingDirectory = readString(record, [
    "cwd",
    "workdir",
    "working_directory",
    "workingDirectory",
  ]);

  const reason = readString(record, ["justification", "reason", "explanation", "purpose"]);
  const programs = programsOf(command);
  const signals = signalsOf(command);
  const fitsCollapsedRow = !command.includes("\n") && command.length <= TRUNCATING_COMMAND_LENGTH;

  const hasDetails =
    !fitsCollapsedRow ||
    workingDirectory !== null ||
    reason !== null ||
    programs.length > 1 ||
    signals.length > 0;

  return { command, workingDirectory, reason, programs, signals, fitsCollapsedRow, hasDetails };
}
