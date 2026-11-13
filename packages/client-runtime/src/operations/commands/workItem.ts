import { WorkItemId } from "@isnadi/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import { type CommandInput, type CommandEffect, commandId, dispatch } from "./dispatch.ts";

export type CreateWorkItemInput = Omit<CommandInput<"work-item.create">, "workItemId"> & {
  readonly workItemId?: WorkItemId;
};

export type AssignWorkItemInput = CommandInput<"work-item.assign">;

export type UpdateWorkItemInput = CommandInput<"work-item.update">;

export type BlockWorkItemInput = CommandInput<"work-item.block">;

export type UnblockWorkItemInput = CommandInput<"work-item.unblock">;

export type CloseWorkItemInput = CommandInput<"work-item.close">;

export type ReopenWorkItemInput = CommandInput<"work-item.reopen">;

/** The server assigns no id for a new item, so the client mints one the way it mints a command id. */
export const createWorkItem: (input: CreateWorkItemInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.createWorkItem",
)(function* (input) {
  const crypto = yield* Crypto.Crypto;

  const workItemId =
    input.workItemId ??
    (yield* crypto.randomUUIDv4.pipe(
      Effect.orDie,
      Effect.map((uuid) => WorkItemId.make(uuid)),
    ));

  return yield* dispatch({
    ...input,
    type: "work-item.create",
    workItemId,
    commandId: yield* commandId(input),
  });
});

export const assignWorkItem: (input: AssignWorkItemInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.assignWorkItem",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "work-item.assign",
    commandId: yield* commandId(input),
  });
});

export const updateWorkItem: (input: UpdateWorkItemInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.updateWorkItem",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "work-item.update",
    commandId: yield* commandId(input),
  });
});

export const blockWorkItem: (input: BlockWorkItemInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.blockWorkItem",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "work-item.block",
    commandId: yield* commandId(input),
  });
});

export const unblockWorkItem: (input: UnblockWorkItemInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.unblockWorkItem",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "work-item.unblock",
    commandId: yield* commandId(input),
  });
});

export const closeWorkItem: (input: CloseWorkItemInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.closeWorkItem",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "work-item.close",
    commandId: yield* commandId(input),
  });
});

export const reopenWorkItem: (input: ReopenWorkItemInput) => CommandEffect = Effect.fn(
  "EnvironmentCommands.reopenWorkItem",
)(function* (input) {
  return yield* dispatch({
    ...input,
    type: "work-item.reopen",
    commandId: yield* commandId(input),
  });
});
