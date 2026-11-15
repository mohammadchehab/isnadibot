/**
 * A small lexer for the shell command strings that arrive with an approval request.
 *
 * It exists because a claim about what a command does has to come from one parse of the
 * string. A regex over the raw text cannot tell `2>&1` from `> out.txt`, `echo "a > b"`
 * from a redirect, or `grep "git push" log` from a push — it sees the same characters in
 * all six. The parse below reads quotes, escapes, comments, heredoc bodies and operators,
 * so a caller can ask what the shell would actually do.
 *
 * Two rules decide every answer here: an operator is only an operator where the shell
 * would read one (never inside a quoted word, an escape or a heredoc body), and a
 * redirection is only a file write when its target is a file the user owns.
 */

/** One word after quote removal, with the fact that it was quoted kept for callers. */
export interface ShellWord {
  readonly value: string;
  /** True when any part of the word was quoted or escaped, so it cannot be an operator. */
  readonly quoted: boolean;
}

/** A redirection operator and the word it points at, when the shell expects one. */
export interface ShellRedirection {
  readonly operator: string;
  readonly target: ShellWord | null;
}

/** One simple command: the words the shell would pass to exec, and its redirections. */
export interface ShellCommand {
  readonly words: readonly ShellWord[];
  readonly redirections: readonly ShellRedirection[];
}

/** The program a segment runs, its arguments, and the wrappers it ran under. */
export interface ShellProgram {
  readonly program: string | null;
  readonly args: ReadonlyArray<string>;
  readonly wrappers: ReadonlyArray<string>;
}

/** The word a quote or escape contributed, and where lexing resumes after it. */
interface QuotedRead {
  readonly text: string;
  readonly next: number;
}

/** A heredoc's delimiter and the index just past the body that delimiter closes. */
interface HeredocRead {
  readonly delimiter: string | null;
  readonly next: number;
}

const SEPARATORS = new Set([";", "\n", "&&", "||", "|", "&", "(", ")", "{", "}"]);

const REDIRECTIONS = new Set([">", ">>", ">|", "&>", "&>>", ">&", "<&", "<"]);

/** A heredoc body is content, so its lines are skipped rather than lexed as commands. */
const HEREDOCS = new Set(["<<", "<<-"]);

/** Operators long before short, so `&&` never reads as `&` and `>>` never as `>`. */
const OPERATORS = [
  "<<-",
  "<<<",
  "&>>",
  "&&",
  "||",
  ">>",
  ">|",
  ">&",
  "<&",
  "&>",
  "<<",
  ";",
  "|",
  "&",
  "(",
  ")",
  "{",
  "}",
  "\n",
  ">",
  "<",
] as const;

/** A heredoc delimiter is a word or a quoted string; `<<` before anything else is a shift. */
const HEREDOC_DELIMITER = /^(?:'([^']*)'|"([^"]*)"|\\?([A-Za-z_][\w-]*))/;

const FILE_WRITE_OPERATORS = new Set([">", ">>", ">|", "&>", "&>>"]);

const NULL_OR_STD_DEVICE = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty"]);

const FILE_DESCRIPTOR = /^(?:\d+|-)$/;

const ENVIRONMENT_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Words the shell runs before the program, which do not change what the program is. */
const COMMAND_WRAPPERS = new Set(["sudo", "command", "exec", "nohup", "time", "env", "xargs"]);

/**
 * A wrapper's own flags that consume the word after them, so that word is the flag's
 * value rather than the program: `sudo -u root rm` runs `rm`, not `root`. Only the
 * flags listed here take the next word with them — a blanket "skip the word after any
 * flag" would break `sudo -E rm`, where `-E` takes no value and `rm` is the program.
 * A flag carrying its value inline (`--user=root`) needs no entry.
 */
const WRAPPER_VALUE_FLAGS = new Map<string, ReadonlySet<string>>([
  [
    "sudo",
    new Set([
      "-u",
      "--user",
      "-g",
      "--group",
      "-p",
      "--prompt",
      "-C",
      "--close-from",
      "-h",
      "--host",
      "-r",
      "--role",
      "-t",
      "--type",
      "-U",
      "--other-user",
      "-D",
      "--chdir",
      "-R",
      "--chroot",
      "-T",
      "--command-timeout",
    ]),
  ],
  ["env", new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"])],
  ["exec", new Set(["-a", "--argv0"])],
  ["time", new Set(["-f", "--format", "-o", "--output"])],
  [
    "xargs",
    new Set([
      "-a",
      "--arg-file",
      "-d",
      "--delimiter",
      "-E",
      "-e",
      "-I",
      "-i",
      "-L",
      "-l",
      "-n",
      "-P",
      "-s",
      "--max-args",
      "--max-procs",
      "--max-chars",
      "--process-slot-var",
    ]),
  ],
]);

type Token =
  | { readonly kind: "word"; readonly word: ShellWord }
  | { readonly kind: "operator"; readonly operator: string }
  | { readonly kind: "fileDescriptor"; readonly descriptor: string };

/** The index just past the quote that closes the one opening at `at`. */
const endOfQuoted = (command: string, at: number, quote: string): number => {
  let cursor = at + 1;

  while (cursor < command.length) {
    if (quote === '"' && command[cursor] === "\\") {
      cursor += 2;

      continue;
    }

    if (command[cursor] === quote) return cursor + 1;

    cursor += 1;
  }

  // An unterminated quote runs to the end of the command, which is where the shell stops too.
  return command.length;
};

/** The word a quote or escape at `at` contributes, and where lexing resumes after it. */
const readQuoted = (command: string, at: number): QuotedRead => {
  const quote = command[at] ?? "";

  if (quote === "\\") {
    return { text: command.slice(at + 1, at + 2), next: at + 2 };
  }

  const end = endOfQuoted(command, at, quote);
  const body = command.slice(at + 1, Math.max(at + 1, end - 1));

  return {
    text: quote === '"' ? body.replace(/\\(["\\$`])/g, "$1") : body,
    next: end,
  };
};

/** The operator at `at`, matched longest first, or null when the character starts a word. */
const operatorAt = (command: string, at: number): string | null => {
  for (const operator of OPERATORS) {
    if (command.startsWith(operator, at)) return operator;
  }

  return null;
};

/**
 * The index just past the arithmetic group opening at `at`, in every form the shell
 * accepts: `$((…))`, `((…))` and `$[…]`. Inside one, `<<` is a shift and `>` is a
 * comparison, so the whole region is read as text rather than as operators.
 */
const endOfArithmetic = (command: string, at: number, opening: string): number => {
  if (opening === "$[") {
    const close = command.indexOf("]", at + 2);

    return close === -1 ? command.length : close + 1;
  }

  let depth = 0;

  for (let cursor = at + (opening === "$((" ? 1 : 0); cursor < command.length; cursor += 1) {
    if (command[cursor] === "(") depth += 1;
    else if (command[cursor] === ")") {
      depth -= 1;

      if (depth === 0) return cursor + 1;
    }
  }

  return command.length;
};

/** The arithmetic group opening at `at`, when the shell would read one there. */
const arithmeticAt = (command: string, at: number, atWordStart: boolean): string | null => {
  if (command.startsWith("$((", at)) return "$((";

  if (command.startsWith("$[", at)) return "$[";

  return atWordStart && command.startsWith("((", at) ? "((" : null;
};

/**
 * The heredoc opening at `at`: its delimiter and the index just past the body that
 * delimiter closes. A body without its closing line runs to the end, as it does in a shell.
 */
const readHeredoc = (command: string, at: number, operator: string): HeredocRead => {
  const match = HEREDOC_DELIMITER.exec(command.slice(at + operator.length).trimStart());
  const delimiter = match?.[1] ?? match?.[2] ?? match?.[3];

  if (delimiter === undefined) return { delimiter: null, next: at + operator.length };

  const stripLeadingTabs = operator === "<<-";
  const bodyStart = command.indexOf("\n", at);

  if (bodyStart === -1) return { delimiter, next: command.length };

  let lineStart = bodyStart + 1;

  while (lineStart <= command.length) {
    const lineEnd = command.indexOf("\n", lineStart);
    const line = command.slice(lineStart, lineEnd === -1 ? command.length : lineEnd);
    const candidate = stripLeadingTabs ? line.replace(/^\t+/, "") : line;

    if (candidate === delimiter) {
      return { delimiter, next: lineEnd === -1 ? command.length : lineEnd };
    }

    if (lineEnd === -1) break;

    lineStart = lineEnd + 1;
  }

  return { delimiter, next: command.length };
};

const lex = (command: string): ReadonlyArray<Token> => {
  const tokens: Token[] = [];
  let word = "";
  let wordStarted = false;
  let quoted = false;
  let at = 0;

  const flushWord = () => {
    if (wordStarted) tokens.push({ kind: "word", word: { value: word, quoted } });

    word = "";
    wordStarted = false;
    quoted = false;
  };

  while (at < command.length) {
    const char = command[at] ?? "";

    if (char === " " || char === "\t" || char === "\r") {
      flushWord();
      at += 1;

      continue;
    }

    // A `#` that starts a word comments out the rest of the line, so what follows is text.
    if (char === "#" && !wordStarted) {
      const lineEnd = command.indexOf("\n", at);

      at = lineEnd === -1 ? command.length : lineEnd;

      continue;
    }

    if (char === "'" || char === '"' || char === "\\") {
      const read = readQuoted(command, at);

      word += read.text;
      wordStarted = true;
      quoted = true;
      at = read.next;

      continue;
    }

    // `$((1 << 2))`, `((x++))` and `$[1 + 2]` are arithmetic: `<<` and `>` inside one are
    // arithmetic operators, not the shell's, so the whole region is read as a single word.
    const arithmetic = arithmeticAt(command, at, !wordStarted);

    if (arithmetic !== null) {
      const end = endOfArithmetic(command, at, arithmetic);

      word += command.slice(at, end);
      wordStarted = true;
      at = end;

      continue;
    }

    const operator = operatorAt(command, at);

    if (operator === null) {
      word += char;
      wordStarted = true;
      at += 1;

      continue;
    }

    // `2>file` redirects descriptor 2 to a file; the digits belong to the operator.
    if (
      (operator === ">" || operator === ">>" || operator === ">|") &&
      wordStarted &&
      !quoted &&
      /^\d+$/.test(word)
    ) {
      tokens.push({ kind: "fileDescriptor", descriptor: word });
      word = "";
      wordStarted = false;
    }

    flushWord();

    if (HEREDOCS.has(operator)) {
      const heredoc = readHeredoc(command, at, operator);

      if (heredoc.delimiter === null) {
        // `<<` before anything but a delimiter is a shift, not a redirection.
        at += operator.length;

        continue;
      }

      tokens.push({ kind: "operator", operator });
      tokens.push({
        kind: "word",
        word: { value: heredoc.delimiter, quoted: false },
      });
      at = heredoc.next;

      continue;
    }

    tokens.push({ kind: "operator", operator });
    at += operator.length;
  }

  flushWord();

  return tokens;
};

/** The command string read as the shell would read it: simple commands and their parts. */
export function parseShellCommands(command: string): ReadonlyArray<ShellCommand> {
  const segments: ShellCommand[] = [];
  let words: ShellWord[] = [];
  let redirections: ShellRedirection[] = [];
  let pending: string | null = null;

  const flushSegment = () => {
    if (words.length > 0 || redirections.length > 0) segments.push({ words, redirections });

    words = [];
    redirections = [];
  };

  for (const token of lex(command)) {
    if (token.kind === "word") {
      if (pending !== null) {
        redirections.push({ operator: pending, target: token.word });
        pending = null;

        continue;
      }

      words.push(token.word);

      continue;
    }

    if (token.kind === "fileDescriptor") continue;

    if (SEPARATORS.has(token.operator)) {
      flushSegment();

      continue;
    }

    if (REDIRECTIONS.has(token.operator)) {
      redirections.push({ operator: token.operator, target: null });
      pending = token.operator;

      continue;
    }
  }

  flushSegment();

  return segments;
}

/**
 * The program a segment runs, past environment assignments and wrappers, its arguments,
 * and the wrappers it ran under — `sudo` is a wrapper, and it is the fact worth reporting.
 */
export function programOf(segment: ShellCommand): ShellProgram {
  const wrappers: string[] = [];
  let wrapper: string | null = null;
  let skipValue = false;

  for (let at = 0; at < segment.words.length; at += 1) {
    const word = segment.words[at];

    if (word === undefined || word.value.length === 0) continue;

    // The word before was a wrapper flag that takes a value, so this word is that
    // value and not the program: `sudo -u root rm` runs `rm`, never `root`.
    if (skipValue) {
      skipValue = false;

      continue;
    }

    if (!word.quoted && ENVIRONMENT_ASSIGNMENT.test(word.value)) continue;

    if (!word.quoted && word.value.startsWith("-")) {
      if (wrapper !== null && WRAPPER_VALUE_FLAGS.get(wrapper)?.has(word.value) === true) {
        skipValue = true;
      }

      continue;
    }

    if (!word.quoted && COMMAND_WRAPPERS.has(word.value)) {
      wrappers.push(word.value);
      wrapper = word.value;

      continue;
    }

    return {
      program: word.value.split("/").at(-1) ?? word.value,
      args: segment.words.slice(at + 1).map((argument) => argument.value),
      wrappers,
    };
  }

  return { program: null, args: [], wrappers };
}

/**
 * True when the shell would write the user's files. A descriptor duplication (`2>&1`,
 * `>&2`, `>&-`) moves a stream between descriptors and a null or std device discards it,
 * so neither is a write; a redirect to any other target is.
 */
export function isFileWriteRedirection(redirection: ShellRedirection): boolean {
  const target = redirection.target?.value ?? null;

  if (target === null || target.length === 0) return false;

  if (FILE_WRITE_OPERATORS.has(redirection.operator)) return !NULL_OR_STD_DEVICE.has(target);

  if (redirection.operator === ">&" || redirection.operator === "<&") {
    // `>&2` and `2>&1` duplicate, `>&-` closes. Bash also accepts `>&file`, which writes.
    if (FILE_DESCRIPTOR.test(target)) return false;

    return redirection.operator === ">&" && !NULL_OR_STD_DEVICE.has(target);
  }

  return false;
}
