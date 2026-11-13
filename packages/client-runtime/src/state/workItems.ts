import { WS_METHODS } from "@isnadi/contracts";
import * as Crypto from "effect/Crypto";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  type AssignWorkItemInput,
  type BlockWorkItemInput,
  type CloseWorkItemInput,
  type CreateWorkItemInput,
  type ReopenWorkItemInput,
  type UnblockWorkItemInput,
  type UpdateWorkItemInput,
  assignWorkItem,
  blockWorkItem,
  closeWorkItem,
  createWorkItem,
  reopenWorkItem,
  unblockWorkItem,
  updateWorkItem,
} from "../operations/commands.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

export type {
  AssignWorkItemInput,
  BlockWorkItemInput,
  CloseWorkItemInput,
  CreateWorkItemInput,
  ReopenWorkItemInput,
  UnblockWorkItemInput,
  UpdateWorkItemInput,
} from "../operations/commands.ts";

/**
 * Work items the shell does not carry: the shell keeps open items only, so a
 * board's Done and Closed columns page in through `workItems.list` and an item's
 * full brief comes from `workItems.get`.
 */
export function createWorkItemEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
) {
  const scheduler = createAtomCommandScheduler();

  // Two commands on one item race their guards, so they run in order per item.
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { workItemId?: string } }) =>
      JSON.stringify([environmentId, "work-item", input.workItemId ?? "new"]),
  };

  return {
    finished: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:work-items:list",
      tag: WS_METHODS.workItemsList,
      staleTimeMs: 5_000,
    }),
    item: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:work-items:get",
      tag: WS_METHODS.workItemsGet,
      staleTimeMs: 30_000,
    }),
    create: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:work-item:create",
      execute: (input: CreateWorkItemInput) => createWorkItem(input),
      scheduler,
      concurrency,
    }),
    assign: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:work-item:assign",
      execute: (input: AssignWorkItemInput) => assignWorkItem(input),
      scheduler,
      concurrency,
    }),
    update: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:work-item:update",
      execute: (input: UpdateWorkItemInput) => updateWorkItem(input),
      scheduler,
      concurrency,
    }),
    block: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:work-item:block",
      execute: (input: BlockWorkItemInput) => blockWorkItem(input),
      scheduler,
      concurrency,
    }),
    unblock: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:work-item:unblock",
      execute: (input: UnblockWorkItemInput) => unblockWorkItem(input),
      scheduler,
      concurrency,
    }),
    close: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:work-item:close",
      execute: (input: CloseWorkItemInput) => closeWorkItem(input),
      scheduler,
      concurrency,
    }),
    reopen: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:work-item:reopen",
      execute: (input: ReopenWorkItemInput) => reopenWorkItem(input),
      scheduler,
      concurrency,
    }),
  };
}
