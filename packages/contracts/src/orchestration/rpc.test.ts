import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { OrchestrationDispatchCommandError } from "./rpc.ts";

const decodeDispatchError = Schema.decodeUnknownSync(OrchestrationDispatchCommandError);

it("decodes a dispatch error carrying an unavailability this build knows", () => {
  const error = decodeDispatchError({
    _tag: "OrchestrationDispatchCommandError",
    message: "Claude hit its usage limit.",
    unavailability: "limit-reached",
  });

  assert.strictEqual(error.unavailability, "limit-reached");
});

it("keeps the message when a newer server names an unavailability this build does not know", () => {
  const error = decodeDispatchError({
    _tag: "OrchestrationDispatchCommandError",
    message: "Codex is out of credits.",
    unavailability: "quota-exhausted",
  });

  assert.strictEqual(error.message, "Codex is out of credits.");
  assert.strictEqual(error.unavailability, "quota-exhausted");
});

it("decodes a dispatch error that names no unavailability", () => {
  const error = decodeDispatchError({
    _tag: "OrchestrationDispatchCommandError",
    message: "The command failed.",
  });

  assert.isUndefined(error.unavailability);
});
