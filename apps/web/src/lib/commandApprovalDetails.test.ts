import { describe, expect, it } from "vite-plus/test";

import { describeCommandApproval } from "./commandApprovalDetails";

describe("describeCommandApproval", () => {
  it("reports no details for a short safe command so the row hides its expander", () => {
    const details = describeCommandApproval("pwd", { command: "pwd" });

    expect(details.hasDetails).toBe(false);
    expect(details.programs).toEqual(["pwd"]);
    expect(details.signals).toEqual([]);
    expect(details.workingDirectory).toBeNull();
    expect(details.reason).toBeNull();
  });

  it("reads the folder and reason the provider sent", () => {
    const details = describeCommandApproval("ls", {
      command: "ls",
      cwd: "/tmp/work",
      justification: "List the build output",
    });

    expect(details.workingDirectory).toBe("/tmp/work");
    expect(details.reason).toBe("List the build output");
    expect(details.hasDetails).toBe(true);
  });

  it("names every program in a chained command", () => {
    const details = describeCommandApproval(
      "cd apps/web && NODE_ENV=test bun run build | tee log",
      {
        command: "x",
      },
    );

    expect(details.programs).toEqual(["cd", "bun", "tee"]);
    expect(details.hasDetails).toBe(true);
  });

  it("flags the effects that change a review decision", () => {
    expect(describeCommandApproval("sudo rm -rf build", {}).signals).toEqual([
      "Runs as root",
      "Deletes files",
    ]);
    expect(describeCommandApproval("curl https://example.com > out.txt", {}).signals).toEqual([
      "Network access",
      "Writes files",
    ]);
    expect(describeCommandApproval("git push origin main", {}).signals).toEqual(["Publishes"]);
    expect(describeCommandApproval("chmod +x run.sh", {}).signals).toEqual(["Changes permissions"]);
  });

  it("treats a multi-line or long command as worth expanding", () => {
    expect(describeCommandApproval("echo one\necho two", {}).hasDetails).toBe(true);
    expect(describeCommandApproval(`echo ${"x".repeat(80)}`, {}).hasDetails).toBe(true);
  });
});

const signalsOf = (command: string): ReadonlyArray<string> =>
  describeCommandApproval(command, {}).signals;

describe("the Writes files signal", () => {
  it("stays off the read-only command that reproduced the wrong tag", () => {
    // The QA run's real command, carrying the `2>&1` the write-up shortened away.
    expect(signalsOf("ls -la /p 2>&1; which node npm; node --version; npm --version")).toEqual([]);
  });

  it("is raised by a redirect that targets a file", () => {
    expect(signalsOf("ls -la /p > out.txt")).toEqual(["Writes files"]);
    expect(signalsOf("ls -la /p >> out.txt")).toEqual(["Writes files"]);
    expect(signalsOf("ls -la /p | tee out.txt")).toEqual(["Writes files"]);
  });

  it("is not raised by descriptor duplication or a null or std device", () => {
    expect(signalsOf("cmd 2>&1")).toEqual([]);
    expect(signalsOf("cmd >&2")).toEqual([]);
    expect(signalsOf("cmd 2>/dev/null")).toEqual([]);
    expect(signalsOf("echo done > /dev/null")).toEqual([]);
    expect(signalsOf("echo done > /dev/stdout")).toEqual([]);
  });

  it("is not raised by an operator inside quotes", () => {
    expect(signalsOf('echo "a > b"')).toEqual([]);
    expect(signalsOf('grep -r "x>y" src')).toEqual([]);
  });
});

describe("the program signals", () => {
  it("are not raised by a quoted word that merely names the program", () => {
    expect(signalsOf('grep "git push" log')).toEqual([]);
    expect(signalsOf('echo "curl"')).toEqual([]);
    expect(signalsOf("grep rm file")).toEqual([]);
  });

  it("read a delete from its program position, whatever it is deleting", () => {
    expect(signalsOf("rm build")).toEqual(["Deletes files"]);
  });
});

describe("the program signals behind a wrapper", () => {
  it("read the program past a wrapper flag that takes a value", () => {
    // `root` is the value of `-u`, so the program is still `rm`: reading the
    // value as the program dropped the pill the fork point showed.
    expect(signalsOf("sudo -u root rm -rf /p")).toEqual(["Runs as root", "Deletes files"]);
    expect(signalsOf("sudo -u root chmod 777 /p")).toEqual(["Runs as root", "Changes permissions"]);
    expect(signalsOf("env -u HOME rm -rf /p")).toEqual(["Deletes files"]);
  });

  it("keep the program when the wrapper flag takes no value", () => {
    expect(signalsOf("sudo -E rm -rf /p")).toEqual(["Runs as root", "Deletes files"]);
    expect(signalsOf("sudo rm -rf /p")).toEqual(["Runs as root", "Deletes files"]);
    expect(signalsOf("command rm -rf /p")).toEqual(["Deletes files"]);
    expect(signalsOf("nohup rm -rf /p")).toEqual(["Deletes files"]);
  });

  it("leave the programs that never took a wrapper value unchanged", () => {
    expect(signalsOf("git push origin main")).toEqual(["Publishes"]);
    expect(signalsOf("curl https://example.com")).toEqual(["Network access"]);
  });
});
