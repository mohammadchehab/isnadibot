import { describe, expect, it } from "vite-plus/test";

import { ExternalLauncherBrowserSpawnError, ExternalLauncherEditorSpawnError } from "./editor.ts";
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
      cause: new Error("EACCES: permission denied"),
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
        cause: new Error("EACCES: permission denied"),
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
          cause: new Error("EACCES: permission denied"),
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
          cause: new Error("EACCES: permission denied"),
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
      cause: new Error("spawn ENOENT"),
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
      cause: new Error("spawn ENOENT"),
    });

    expect(error.message).toBe("Failed to launch the browser.");
    expect(error.message).not.toContain("isnadi.local");
    expect(error.message).not.toContain("/usr/bin/open");
    expect(error.target).toBe("https://isnadi.local:7443/threads/thread-1");
  });
});
