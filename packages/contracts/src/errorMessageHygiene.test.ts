import { describe, expect, it } from "vite-plus/test";

import { ExternalLauncherBrowserSpawnError, ExternalLauncherEditorSpawnError } from "./editor.ts";
import {
  ISNADI_MEMORY_FAILURE_COPY,
  IsnadiMemoryFailureReason,
  IsnadiMemoryOperation,
  IsnadiMemoryOperationError,
} from "./isnadiMemory.ts";
import { KeybindingsConfigError } from "./keybindings.ts";
import { ServerSettingsError, ServerSettingsOperation } from "./settings/server.ts";

const SETTINGS_PATH = "/Users/alex/Library/Application Support/isnadi/state/settings.json";

const KEYBINDINGS_PATH = "/Users/alex/.isnadi/keybindings.json";

const INSTANCE_ID = "provider-instance-7";

const ENVIRONMENT_VARIABLE = "OPENAI_API_KEY";

/**
 * A failure sentence is read on a screen, so it describes the work in plain
 * words. The path, the instance id and the variable name stay on the error's
 * own fields, where a log reads them and no surface prints them. Each case here
 * fails if its getter goes back to interpolating a field.
 *
 * The source-level tripwire for the next error class lives in
 * `apps/server/src/messageHygiene.test.ts`, because this package carries no
 * filesystem access of its own.
 */
describe("A settings failure describes the work, not the file", () => {
  it("keeps the path, the instance and the variable off the message", () => {
    const error = new ServerSettingsError({
      settingsPath: SETTINGS_PATH,
      operation: "write-file",
      providerInstanceId: INSTANCE_ID,
      environmentVariable: ENVIRONMENT_VARIABLE,
    });

    expect(error.message).toBe("The server settings could not be saved.");
    expect(error.message).not.toContain(SETTINGS_PATH);
    expect(error.message).not.toContain(INSTANCE_ID);
    expect(error.message).not.toContain(ENVIRONMENT_VARIABLE);

    expect(error.settingsPath).toBe(SETTINGS_PATH);
    expect(error.providerInstanceId).toBe(INSTANCE_ID);
    expect(error.environmentVariable).toBe(ENVIRONMENT_VARIABLE);
  });

  it("gives every operation a sentence that names no path, instance, variable or operation", () => {
    for (const operation of ServerSettingsOperation.literals) {
      const error = new ServerSettingsError({
        settingsPath: SETTINGS_PATH,
        operation,
        providerInstanceId: INSTANCE_ID,
        environmentVariable: ENVIRONMENT_VARIABLE,
      });

      expect(error.message.length).toBeGreaterThan(0);
      expect(error.message).not.toContain(SETTINGS_PATH);
      expect(error.message).not.toContain(INSTANCE_ID);
      expect(error.message).not.toContain(ENVIRONMENT_VARIABLE);
      expect(error.message).not.toContain(operation);
      expect(error.message.toLowerCase()).not.toContain("try again");
    }
  });

  it("says what failed instead of one line covering every operation", () => {
    const messages = ServerSettingsOperation.literals.map(
      (operation) =>
        new ServerSettingsError({
          settingsPath: SETTINGS_PATH,
          operation,
        }).message,
    );

    expect(new Set(messages).size).toBeGreaterThan(1);
  });

  it("reuses a sentence where operations are the same user situation", () => {
    const messages = ServerSettingsOperation.literals.map(
      (operation) =>
        new ServerSettingsError({
          settingsPath: SETTINGS_PATH,
          operation,
        }).message,
    );

    expect(new Set(messages).size).toBeLessThan(ServerSettingsOperation.literals.length);
  });
});

describe("A keybindings failure describes the work, not the file", () => {
  it("keeps the config path off the message", () => {
    const error = new KeybindingsConfigError({
      configPath: KEYBINDINGS_PATH,
      detail: "Expected a comma at position 12",
    });

    expect(error.message).toBe(
      "Unable to parse keybindings config: Expected a comma at position 12",
    );
    expect(error.message).not.toContain(KEYBINDINGS_PATH);
    expect(error.configPath).toBe(KEYBINDINGS_PATH);
  });
});

describe("An editor launch failure names neither the file nor the command", () => {
  it("keeps the editor and drops the target, command and args", () => {
    const error = new ExternalLauncherEditorSpawnError({
      editor: "cursor",
      target: KEYBINDINGS_PATH,
      command: "/Applications/Cursor.app/Contents/MacOS/Cursor",
      args: ["-n", KEYBINDINGS_PATH],
    });

    expect(error.message).toBe("Failed to launch cursor.");
    expect(error.message).not.toContain(KEYBINDINGS_PATH);
    expect(error.message).not.toContain("/Applications");
    expect(error.target).toBe(KEYBINDINGS_PATH);
    expect(error.command).toBe("/Applications/Cursor.app/Contents/MacOS/Cursor");
  });

  it("keeps the browser target off the message", () => {
    const error = new ExternalLauncherBrowserSpawnError({
      target: "https://isnadi.local:7443/threads/thread-1",
      command: "/usr/bin/open",
      args: ["-a", "Google Chrome"],
    });

    expect(error.message).toBe("Failed to launch the browser.");
    expect(error.message).not.toContain("isnadi.local");
    expect(error.message).not.toContain("/usr/bin/open");
    expect(error.target).toBe("https://isnadi.local:7443/threads/thread-1");
  });
});

const MEMORY_DETAIL = `ENOENT: no such file or directory, open '${SETTINGS_PATH}'`;

describe("A memory failure describes the work, not the file", () => {
  it("keeps the raw cause off the message", () => {
    const error = new IsnadiMemoryOperationError({
      operation: "facts.list",
      detail: MEMORY_DETAIL,
    });

    expect(error.message).toBe("The memory could not be read.");
    expect(error.message).not.toContain(SETTINGS_PATH);
    expect(error.message).not.toContain("ENOENT");
    expect(error.detail).toBe(MEMORY_DETAIL);
  });

  it("gives every operation a sentence that names no path, id or operation", () => {
    for (const operation of IsnadiMemoryOperation.literals) {
      const error = new IsnadiMemoryOperationError({ operation, detail: MEMORY_DETAIL });

      expect(error.message).toBe(ISNADI_MEMORY_FAILURE_COPY[operation]);
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.message).not.toContain(SETTINGS_PATH);
      expect(error.message).not.toContain(INSTANCE_ID);
      expect(error.message).not.toContain(operation);
    }
  });

  it("says what failed instead of one line covering every operation", () => {
    const messages = new Set(Object.values(ISNADI_MEMORY_FAILURE_COPY));

    expect(messages.size).toBeGreaterThan(1);
    expect(messages.size).toBeLessThan(IsnadiMemoryOperation.literals.length);
  });

  it("lets an authored condition say what to do, not just what was attempted", () => {
    const messages = IsnadiMemoryFailureReason.literals.map(
      (reason) =>
        new IsnadiMemoryOperationError({
          operation: "document.replace",
          reason,
          detail: MEMORY_DETAIL,
        }).message,
    );

    // Each of the five conditions has its own remedy, so no two share a sentence
    // and none of them falls back to the operation's own line.
    expect(new Set(messages).size).toBe(IsnadiMemoryFailureReason.literals.length);
    expect(messages).not.toContain(ISNADI_MEMORY_FAILURE_COPY["document.replace"]);

    for (const message of messages) expect(message).not.toContain(SETTINGS_PATH);
  });

  it("keeps the store's own words for a changed memory and a changed bot", () => {
    const messageFor = (reason: IsnadiMemoryFailureReason) =>
      new IsnadiMemoryOperationError({
        operation: "document.replace",
        reason,
        detail: MEMORY_DETAIL,
      }).message;

    expect(messageFor("memory-changed")).toBe(
      "Memory changed since you opened it. Reopen memory before saving.",
    );
    expect(messageFor("bot-changed")).toBe("The active bot changed. Reopen memory before saving.");
  });
});
