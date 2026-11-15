import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { classifyIsnadiExternalCommand } from "@isnadi/contracts";
import { afterAll, describe, expect, it } from "vite-plus/test";

/**
 * The shell, not this file, decides which of these shapes hides a command.
 *
 * Every fixture below is a whole script: an opener line, a payload, and a line
 * equal to the delimiter the scanner might read out of the opener. Whether the
 * payload is a command or content is measured by running the script in real bash
 * and looking for the marker the payload leaves. A body that a `cat` writes out
 * cannot fake that marker, so "bash ran it" and "bash printed it" stay apart.
 *
 * That is the invariant the classifier owes: a shape the shell executes must
 * classify as destructive, in the same breath as a body the shell never runs
 * must not. Reasoning about bash instead of running it is what let three rounds
 * of phantom openers through.
 */
const PAYLOAD = "rm -rf ./payload; touch marker";

const lines = (...parts: ReadonlyArray<string>) => parts.join("\n");

/** Shapes whose `<<` the shell reads as text, so the payload line after it runs. */
const hiddenBehindARegion = [
  ["parameter expansion ${…}", lines("echo ${x:-<<EOF}", PAYLOAD, "EOF")],
  ["ANSI-C quoting $'…'", lines("$'a\\'b <<EOF'", PAYLOAD, "EOF")],
  ["backtick substitution", lines("echo `cat <<EOF`", PAYLOAD, "EOF")],
  ['locale quoting $"…"', lines('echo $"see <<EOF"', PAYLOAD, "EOF")],
  ["a quoted string", lines('echo "see <<EOF"', PAYLOAD, "EOF")],
  // The shell reports a syntax error inside the parens, then runs the next line.
  ["an array assignment a=(…)", lines("a=(<<EOF)", PAYLOAD, "EOF")],
  [
    "an extglob case pattern @(…)",
    lines("shopt -s extglob", "case x in @(<<EOF)) ;; esac", PAYLOAD, "EOF"),
  ],
  // An array subscript is arithmetic without the `$`: the shell expands the
  // shift, reports the right operand as a missing command, and runs the next
  // line. Each row's delimiter is that operand, not `EOF`.
  ["an array subscript shift", lines("a[1<<B]=x", PAYLOAD, "B")],
  ["an array subscript with a name", lines("a[i<<D]=x", PAYLOAD, "D")],
  ["an array subscript with spaces", lines("a[1 << B]=x", PAYLOAD, "B")],
  ["an array subscript append", lines("a[1<<B]+=x", PAYLOAD, "B")],
  ["an integer array subscript", lines("declare -i a", "a[1<<B]=1", PAYLOAD, "B")],
] as const;

/** Shapes where the payload really is body, which the shell writes and never runs. */
const contentNotCommands = [
  ["a heredoc body", lines("cat > f.txt <<EOF", PAYLOAD, "EOF")],
  [
    "a body naming the regions the scanner will not read",
    lines(
      "cat > f.ts <<'EOF'",
      "const id = `${environment}:${id}`;",
      "const out = $'a\\'b';",
      "echo `cat <<EOF`",
      PAYLOAD,
      "EOF",
    ),
  ],
] as const;

const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "isnadi-bash-"));

afterAll(() => {
  NodeFS.rmSync(directory, { recursive: true, force: true });
});

/** Whether real bash runs `script`'s payload: it leaves a marker in its own directory. */
const shellRunsPayload = (name: string, script: string): boolean => {
  const caseDirectory = NodePath.join(directory, name.replace(/[^a-z0-9]+/gi, "-"));

  NodeFS.mkdirSync(caseDirectory, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(caseDirectory, "case.sh"), `${script}\n`);
  NodeChildProcess.spawnSync("bash", ["case.sh"], { cwd: caseDirectory, stdio: "ignore" });

  return NodeFS.existsSync(NodePath.join(caseDirectory, "marker"));
};

/** Skip where there is no bash to measure against, rather than assert a bash that is not there. */
const shellIt = it.skipIf(NodeChildProcess.spawnSync("bash", ["-c", "exit 0"]).status !== 0);

describe("Shell command intent measured against bash", () => {
  shellIt("classifies as destructive every shape bash really runs", () => {
    for (const [name, script] of hiddenBehindARegion) {
      // The fixture only means something if bash executes it; assert that first
      // so a shape bash does not run cannot pass by accident.
      expect(shellRunsPayload(name, script), `${name}: bash must run the payload`).toBe(true);
      expect(classifyIsnadiExternalCommand(script), name).toBe("delete");
    }
  });

  shellIt("leaves a body bash never runs unclassified", () => {
    for (const [name, script] of contentNotCommands) {
      expect(shellRunsPayload(name, script), `${name}: bash must not run the payload`).toBe(false);
      expect(classifyIsnadiExternalCommand(script), name).toBeUndefined();
    }
  });
});
