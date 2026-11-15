import { describe, expect, it } from "vite-plus/test";

import {
  isFileWriteRedirection,
  parseShellCommands,
  programOf,
  type ShellRedirection,
} from "./shellCommand.ts";

const redirectionsOf = (command: string): ReadonlyArray<ShellRedirection> =>
  parseShellCommands(command).flatMap((segment) => segment.redirections);

const writesOf = (command: string): boolean =>
  redirectionsOf(command).some((redirection) => isFileWriteRedirection(redirection));

const programsOf = (command: string): ReadonlyArray<string> =>
  parseShellCommands(command)
    .map((segment) => programOf(segment).program)
    .filter((program): program is string => program !== null);

describe("parseShellCommands", () => {
  it("splits a chain into the commands the shell would run", () => {
    expect(programsOf("cd apps/web && NODE_ENV=test bun run build | tee log")).toEqual([
      "cd",
      "bun",
      "tee",
    ]);
  });

  it("keeps a quoted separator inside its word", () => {
    expect(programsOf('echo "a; b"')).toEqual(["echo"]);
    expect(parseShellCommands('echo "a; b"')).toHaveLength(1);
  });

  it("keeps an escaped separator inside its word", () => {
    expect(parseShellCommands("echo a\\;b")).toHaveLength(1);
  });

  it("stops reading a line at a comment", () => {
    expect(redirectionsOf("echo hi # > out.txt")).toEqual([]);
  });

  it("reads a redirect to a file as a write", () => {
    expect(writesOf("ls -la /p > out.txt")).toBe(true);
    expect(writesOf("ls -la /p >> out.txt")).toBe(true);
    expect(writesOf("ls -la /p >| out.txt")).toBe(true);
    expect(writesOf("ls -la /p 2> errors.txt")).toBe(true);
    expect(writesOf("cmd &> both.txt")).toBe(true);
    expect(writesOf("cmd >& both.txt")).toBe(true);
  });

  it("does not read descriptor duplication as a write", () => {
    expect(writesOf("ls -la /p 2>&1")).toBe(false);
    expect(writesOf("cmd >&2")).toBe(false);
    expect(writesOf("cmd 2>&1 1>&2")).toBe(false);
    expect(writesOf("cmd >&-")).toBe(false);
  });

  it("does not read a null or std device as a write", () => {
    for (const device of ["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty"]) {
      expect(writesOf(`echo done > ${device}`)).toBe(false);
      expect(writesOf(`echo done >> ${device}`)).toBe(false);
    }
  });

  it("does not read an operator inside quotes or an escape as one", () => {
    expect(redirectionsOf('echo "a > b"')).toEqual([]);
    expect(redirectionsOf("grep -r 'x>y' src")).toEqual([]);
    expect(redirectionsOf("echo a\\>b")).toEqual([]);
  });

  it("skips a heredoc body instead of reading it as commands", () => {
    const command = ["cat > notes.txt <<EOF", "rm -rf build > gone.txt", "EOF", "echo done"].join(
      "\n",
    );

    const segments = parseShellCommands(command);

    expect(segments.map((segment) => programOf(segment).program)).toEqual(["cat", "echo"]);
    expect(writesOf(command)).toBe(true);
  });

  it("skips a tab-stripped heredoc body", () => {
    const command = ["cat <<-EOF", "\trm -rf build", "\tEOF", "echo done"].join("\n");

    expect(parseShellCommands(command).map((segment) => programOf(segment).program)).toEqual([
      "cat",
      "echo",
    ]);
  });

  it("reads a shift as an operator, not a heredoc", () => {
    const command = "echo $((1 << 2)) > shift.txt";
    const segments = parseShellCommands(command);

    expect(segments.map((segment) => programOf(segment).program)).toEqual(["echo"]);
    expect(writesOf(command)).toBe(true);
  });

  it("reads a program past wrappers, assignments and flags", () => {
    const [segment] = parseShellCommands("env FOO=1 sudo /usr/bin/rm -rf build");

    if (segment === undefined) throw new Error("expected one segment");

    expect(programOf(segment)).toEqual({
      program: "rm",
      args: ["-rf", "build"],
      wrappers: ["env", "sudo"],
    });
  });
});
