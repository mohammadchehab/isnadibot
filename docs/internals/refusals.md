# Refusals and invariant failures

A command that fails has to say why, and the answer has two audiences. The person who pressed the button needs a sentence they can act on, in their own language. Whoever reads the log needs to know whether the refusal was a real user situation or a bug. This document defines both, and it defines the one place in the code where a throw has to answer the question.

The rule this file exists to enforce: **a server invariant throw carries exactly one of a refusal code, a reachability exclusion, or a registered pending-refusal entry.** It cannot carry none. That is the whole of TASK-304.

## What a failed command can say

Three things, in the order the code produces them.

**`message`** is the technical sentence, built by the error's `message` getter. It is what the log records and what a client falls back to when it has nothing better. It names identifiers (`Bot 'bot_123' is the boss of group 'grp_9'`), so it is not user copy.

**A refusal code** is the user-facing reason. It is a literal from `CommandRefusal` (`packages/contracts/src/orchestration/refusals.ts`, 28 codes at `a9c23dcdd`). The client turns it into a sentence with `commandRefusalMessage`, which reads `refusalMessages: Record<CommandRefusal, MessageKey>` in `packages/client-runtime/src/state/commandFailure.ts`. Because the map is a `Record` over the union, a new code fails to compile until every surface has copy for it.

**An exclusion** is the server's answer to "why is there no code here?". It never leaves the server. It exists so a later reader does not have to re-derive the call, and so a wrong filing is visible as a wrong filing instead of as silence.

### The wire

Every client command path funnels its failure through `toDispatchCommandError` (`apps/server/src/wsServices.ts:552`). It copies `message` and `refusal` onto `OrchestrationDispatchCommandError` and drops everything else. On the wire, `refusal` is a permissive `TrimmedNonEmptyString` (`packages/contracts/src/orchestration/rpc.ts:293`) on purpose: a code an older client has never heard of must reach it as a string it can ignore, not fail the decode and lose `message` too.

The exclusion and the failure classification stay server-side. Nothing in this document changes that, and the tests in the last section keep it that way.

## The vocabulary rules

These are not invented here. They were established ruling by ruling as codes were minted, and they are what keeps the 28 codes from drifting into 60.

**The noun rule.** A code includes, in front of the user, the noun the situation is about. `bot-is-group-boss` says _bot_ and _group_. A code that says only "this is not allowed" cannot be translated into a sentence that names the thing, and the surfaces share codes across settings, roster and chat, so the sentence has to carry its own subject.

**The two-condition test.** Two conditions share one code if and only if the same sentence would be true for both **and** the remedy is the same. Different remedy, different code, even when the sentence would read the same. `group-requires-boss` and `group-already-has-boss` pass the sentence half and fail the remedy half, which is why both exist.

**Minting.** Mint a code only when no existing sentence is true for the situation **and** the remedy differs from every existing code's remedy. Applying an existing code is always the cheaper answer, because a new code costs three locale catalogs and a decision on every surface.

**Reachability letters.** Every throw with no code is filed under one of these, and the letter comes from the contract union, never from a comment or from a producer list:

- **R** — server-only input: the command is not in the client's command union, so no client can send it.
- **A** — actor guard: the branch requires `actor === undefined`, and the dispatch path always supplies an actor.
- **C** — contract filter: the schema rejects the input at decode, so the branch cannot be reached with valid input.
- **U** — no shipped surface: the contract permits the command, and no shipped screen dispatches it today.

R, A and C are closed by the contract. **U expires the moment a surface adds a control**, which is why it is a separate label and not folded into the others: a row filed as U is a claim about today's clients, and nothing re-reads it later.

## The invariant failure union (TASK-304)

### The defect

`OrchestrationCommandInvariantError` (`apps/server/src/orchestration/Errors.ts:56`) carries both `refusal` and `exclusion` as `Schema.optional`. A throw can therefore supply neither, compile, ship, and reach a user as a technical English sentence with no code and no exclusion. At `a9c23dcdd` that is 26 production constructions with neither, plus 18 more routed through one uncoded local factory — see the measurement note at the end.

The two factories `internalInvariantError` and `noShippedSurfaceInvariantError` (`Errors.ts:91`, `Errors.ts:110`) already exist and already write the exclusion. They are the right idea with the wrong enforcement: nothing stops the next throw from bypassing them, and nothing stops the two pass-throughs from dropping what they were given.

### The target shape

One error class. The reason becomes a required discriminated union, so the constructor asks the question at every throw.

```ts
/**
 * Why a command was refused. Exactly one arm, always present, so a throw with
 * nothing to say cannot be written.
 */
export const InvariantFailure = Schema.Union([
  /** A user situation with a dedicated code. Travels to the client. */
  Schema.TaggedStruct("refused", { refusal: CommandRefusal }),
  /** Nothing a user can reach, so no code is possible. Server-side only. */
  Schema.TaggedStruct("excluded", { exclusion: InvariantExclusion }),
  /** Reachable, and the code it needs has not been minted yet. */
  Schema.TaggedStruct("pending-refusal", {
    reason: Schema.String,
    ticket: Schema.String,
  }),
]);

export type InvariantFailure = typeof InvariantFailure.Type;
```

```ts
export class OrchestrationCommandInvariantError extends Schema.TaggedErrorClass<OrchestrationCommandInvariantError>()(
  "OrchestrationCommandInvariantError",
  {
    commandType: Schema.String,
    detail: Schema.String,
    failure: InvariantFailure,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  /** The code a client has a sentence for, when there is one. */
  get refusal(): CommandRefusal | undefined {
    return this.failure._tag === "refused" ? this.failure.refusal : undefined;
  }

  /** Why there is no code. Never crosses the wire. */
  get exclusion(): InvariantExclusion | undefined {
    return this.failure._tag === "excluded" ? this.failure.exclusion : undefined;
  }

  override get message(): string {
    return `Orchestration command invariant failed (${this.commandType}): ${this.detail}`;
  }
}
```

This is the shape `BotMemoryError` already uses (`apps/server/src/memory/BotMemoryTypes.ts:13-39`): a required union on `reason`, a `TaggedErrorClass` around it, a factory for the common case. An engineer implementing this has a working file in the repo to copy rather than a shape to invent.

`refusal` and `exclusion` stay readable as getters so that the wire path (`wsServices.ts:555`), the reactor checks (`Layers/FleetDispatcherReactor.ts:583`, `Layers/GroupResponderQueueReactor.ts:263`, `Layers/OrchestrationEngine.ts:60`) and every `Schema.is` site keep working untouched. Only construction changes.

### Why the union cannot be the error class itself

`Schema.TaggedErrorClass` takes `Struct.Fields` or a `Struct`, never a `Union` (`.repos/effect-smol/packages/effect/src/Schema.ts:14467-14484`). A union handed to it does not produce a tagged error; it produces something that fails `isStruct` and goes down the `TaggedStruct` path with a union where a struct belongs. A field **can** hold a union — fields are `Struct.Fields` and each value is any schema. That is why the union goes one level in, on `failure`, and not on the class.

### The three arms

**`refused`** is a user situation with a code. This is what the 28-code campaign produces, and what most sites should be.

**`excluded`** is the existing two-kind exclusion, unchanged in meaning:

- `internal-command` — a client cannot dispatch it, its schema rejects the input, or the dispatch path always supplies what the guard requires. Closed by the contract.
- `no-shipped-surface` — the contract permits it and no shipped surface sends it. Expires the moment a control appears.

**`pending-refusal`** is new, and it is the honest answer for a site that is reachable but whose code has not been minted. Without it, TASK-304 has only two ways to migrate a reachable throw: mint a code (which is TASK-305's vocabulary work, three locales and a surface decision per code) or file it under an exclusion that is not true. Filing a reachable throw as `no-shipped-surface` is exactly the failure the `InvariantExclusion` doc comment warns about — one label hiding under another, with nothing that re-reads it.

`pending-refusal` is the one arm that is allowed to shrink and never allowed to grow. It carries a `ticket`, so the debt names who pays it, and its count is pinned by a test (see Testing). The campaign is over when the count is zero and the arm is deleted.

### What must not change

- The 28 codes and the sentences in `refusalMessages`. This is a mechanism change; not one user-visible string moves.
- The wire. `OrchestrationDispatchCommandError` keeps `message` plus a permissive `refusal`, and still receives nothing else.
- `classifyCommandFailure`, `commandRefusalMessage` and `commandFailureMessage` in `packages/client-runtime/src/state/commandFailure.ts`.
- The `InvariantExclusion` doc comment and its two-kind reasoning. It is the reason `pending-refusal` is a separate arm rather than a third `kind`.
- Every existing test that asserts a `_tag` of `"OrchestrationCommandInvariantError"`. The tag does not move.

### The two pass-throughs to close

Making `failure` required closes the class, but two local helpers currently launder the answer and must be closed in the same change or the union is decorative:

- **`commandInvariants.ts:23-33`** — `invariantError(commandType, detail, refusal?)` spreads `refusal` only when defined, which is how an uncoded throw gets through this file. All 22 call sites already pass a code, so the third parameter becomes required and the spread disappears. Free.
- **`decider/workItems.ts:50-51`** — `reject(command, detail)` takes no reason at all and serves 18 throw sites. It gains a third parameter typed as `InvariantFailure`'s `refused` arm.

### Migration

A type change has no compilable intermediate state. Step 1 breaks every construction site at once, so the whole migration is one PR, one concern ("the invariant failure becomes a union"), and the compiler's error list is the work list:

1. `Errors.ts`: add `InvariantFailure`, make `failure` required, add the getters and `pendingRefusalInvariantError`.
2. `commandInvariants.ts`: require the third parameter, call `refusedInvariantError`.
3. `decider/workItems.ts`: `reject` gains its reason; classify its 18 sites.
4. The 22 direct `new OrchestrationCommandInvariantError(...)` sites outside those helpers.
5. Test fixtures that construct the error.
6. **Delete the source-reading guard** at `apps/server/src/orchestration/commandInvariants.refusals.test.ts:416-447`. It asserts that every `invariantError` call in that one file carries a code, and its own comment says so: "TEMPORARY. TASK-304 makes the invariant failure a discriminated union, so an uncoded throw stops compiling; delete this test when that lands, or the two will disagree about what 'coded' means." Once the union is in, the test is a weaker copy of the compiler and it will drift. Same PR, not a follow-up.

The PR will be large by construction. Reviewers should read `Errors.ts`, `commandInvariants.ts`, `workItems.ts` and the classification table in the PR body; the rest is mechanical.

Classification rule while migrating: **if an existing code's sentence is already true for the situation, use it.** That is free — no locale work, no surface decision — and it keeps `pending-refusal` for genuinely new vocabulary. `already-exists` is true of `Routine 'x' already exists`; `stale-view` is true of `Bot 'x' is no longer archived at ...`. Most of the 26 resolve this way, and the remainder are TASK-305's.

### Testing

**The compiler is the test for the guarantee.** TASK-304's acceptance criterion "an uncoded throw cannot compile" cannot be a unit test in this repo, because `@ts-expect-error` is banned (`AGENTS.md`, "No suppressions", enforced by `scripts/check-lint-suppressions.ts`). Prove it by mutation, recorded in the PR body: delete `failure` from one throw in `decider/routines.ts`, run `vp typecheck`, paste the error, revert, re-run to green.

**The ratchet.** A test scans `apps/server/src` for `_tag: "pending-refusal"` and asserts two things: the count equals a named `PENDING_REFUSAL_COUNT` constant, and every occurrence carries a `ticket` matching `/^TASK-\d+$/`. A new reachable throw with no code therefore fails CI until someone registers it, and draining one requires lowering the constant. The constant reaching zero deletes the arm.

**The exclusion stays server-side.** Dispatch a command whose throw carries an exclusion through `toDispatchCommandError` and assert the result has no `exclusion` and no `failure` key. `decider.invariantExclusions.test.ts` is the natural home.

**Nothing regressed for the user.** The existing refusal tests are the guard: `commandInvariants.refusals.test.ts`, `decider.threadState.refusals.test.ts`, `apps/web/src/components/roster/refusalParity.test.ts`, `apps/mobile/src/features/threads/botDeleteRefusal.test.ts`.

Run `vp test run` on those files, and `vp lint` plus `vp typecheck` on the files touched. Not repo-wide checks.

### Security notes for the security-architect

- The free-text `reason` on an exclusion and on `pending-refusal` names internal command types, group and bot identifiers and sometimes file paths. It must never reach a client. The wire test above is the enforcement; `wsServices.ts:552` is the only conversion point.
- The `refusal` getter must not widen what crosses the wire. A `pending-refusal` site is, by definition, one where the client has no sentence, and the client must keep falling back to `message` rather than decode-fail. The permissive wire string already guarantees that; the change must not tighten it.
- Getter values live on the prototype. Anything that spreads the error (`{ ...cause }`) loses `refusal` and falls back to the technical message. That is a visible degradation, not a silent leak, but readers should use `.refusal` rather than a spread.

### Open questions

1. **Is `pending-refusal` acceptable, or should TASK-304 block until every site has a code?** Recommendation: accept it. A code that has not been minted cannot be demanded at the throw, and the alternative — filing reachable throws as `no-shipped-surface` — is a false claim the repo would then have to un-learn.
2. **Does the routines family's client half ride with TASK-305 or split off?** See the next section. Recommendation: split, because the server half and the client half fail independently.

## The routines family is a second shape (TASK-305)

TASK-305 is **not** the same shape as TASK-304. TASK-304 is mechanism: one type, no user-visible change, and the work is classification. TASK-305 is vocabulary and surface: which code each routine throw needs, what sentence it shows, three locale catalogs, and two client screens that currently throw the reason away. The mechanism ends with TASK-304; TASK-305 consumes it.

### The register

`apps/server/src/orchestration/decider/routines.ts` holds 15 throws, none coded, at `a9c23dcdd`. The reachability letter comes from `ClientRoutineCommand` versus `InternalRoutineCommand` (`packages/contracts/src/routines.ts:342-351`, `:413-421`).

| line | command                                        | detail                          | letter  | first candidate               |
| ---- | ---------------------------------------------- | ------------------------------- | ------- | ----------------------------- |
| 50   | `routine.create-approved`                      | routine already exists          | **R**   | `excluded/internal-command`   |
| 101  | `routine.draft`                                | routine is deleted              | refused | needs a code                  |
| 112  | `routine.draft`                                | procedure version changed       | refused | needs a code                  |
| 169  | `routine.approve`                              | cannot approve version N        | refused | needs a code                  |
| 205  | `routine.enable`                               | requires approval before enable | refused | needs a code                  |
| 242  | `routine.pause`                                | routine does not exist          | refused | `stale-view`? judge           |
| 275  | `routine.run`, `routine.run.scheduled`         | routine does not exist          | refused | `stale-view`? judge           |
| 282  | same case                                      | routine is not enabled          | refused | needs a code                  |
| 289  | same case                                      | procedure approval is stale     | refused | needs a code                  |
| 296  | same case                                      | run already exists              | refused | `already-exists`              |
| 357  | `routine.run.start/block/fail/complete/cancel` | run does not exist              | **R**   | `excluded/internal-command`   |
| 371  | same case                                      | run already ended               | **R**   | `excluded/internal-command`   |
| 481  | `routine.delete`                               | routine does not exist          | refused | `stale-view`? judge           |
| 514  | `routine.skill.assign`                         | assignment already exists       | refused | `already-exists`              |
| 548  | `routine.skill.unassign`                       | assignment does not exist       | **U**   | `excluded/no-shipped-surface` |

Three rows are R (no client can send those commands). One row is U: `routine.skill.unassign` is wired into the shared environment atoms (`packages/client-runtime/src/state/routines.ts:58`) and no shipped screen calls it, while `assignSkill` is called by web (`apps/web/src/routes/_chat.bots.$botId.tsx:55`). That row expires the day mobile grows an unassign control, which is the reason it is a U and not an R.

Eleven rows are reachable user situations, and the register above is a starting point, not a ruling: each needs the two-condition test against the 28 existing codes before anything is minted.

### The surface half, which is missing on both clients

Both shipped routine surfaces discard the reason. This is the part TASK-305 cannot skip, because a code nobody reads changes nothing for the user.

**Web** (`apps/web/src/routes/_chat.bots.$botId.tsx:102-106`) checks the result tag and toasts a fixed per-action string:

```ts
const requireSuccess = (result: { readonly _tag: string }, message: string) => {
  if (hasTag(result, "Success")) return;
  toastManager.add({ type: "error", title: message });
  throw new Error(message);
};
```

so a stale approval shows "Could not approve procedure" and never the reason.

**Mobile** (`apps/mobile/src/features/threads/ThreadRoutinesScreen.tsx:216-235`) is blunter, and says why in a comment:

```ts
if (Predicate.isTagged(result, "Failure")) {
  // Server errors can be technical English, so the card shows only translated copy.
  setFailure({ routineId, message: fallback });
}
```

That comment describes the exact problem refusal codes were built to solve. More than a dozen other call sites already call `commandFailureMessage(result, { t, fallback })` and get the translated reason when there is one; the routine screens are the outlier.

The fix on both is the same one-liner in shape — replace the fixed string with `commandFailureMessage(result, { t, fallback })` — but it needs a copy decision per code on each surface, which is why it belongs to TASK-305 and not to the mechanism PR.

## The exclusion register and the reopening rule

Every exclusion row makes a claim that expires:

- `internal-command` expires when the contract changes. If a command moves from `InternalRoutineCommand` to `ClientRoutineCommand`, every exclusion justified by R is wrong the same day.
- `no-shipped-surface` expires when a control appears. Nothing in CI notices; the claim is about shipped clients, and shipped clients change without touching the server.

The reopening rule: **whoever widens a client command union, or adds a control that dispatches a command with a `no-shipped-surface` exclusion, re-reads that command's rows in the same PR.** The register is the list of places to look, and this file is where it lives.

### One command per register

The card's acceptance criterion asks for `git grep internalInvariantError` to list every exclusion. That still holds, and it now has two companions:

```
git grep -n 'internalInvariantError\|noShippedSurfaceInvariantError' apps/server/src
git grep -n '_tag: "pending-refusal"' apps/server/src
```

The first lists every reachability exclusion with its written reason. The second lists the debt, and its count is the number the ratchet pins. Neither is an allowlist file to maintain, and neither can drift from the code, because both read the code.

## Adding to the family

When a new invariant throw is written:

1. Is there an existing code whose sentence is true and whose remedy matches? Use it.
2. Is it reachable by a client? If no, pick the letter (R, A, C, U) and write the reason naming the contract fact.
3. If it is reachable and no code fits, mint the code (`refusals.ts`), add copy for every surface (`refusalMessages`), and add the locale entries. That is the expensive path; it is the right one when the user has a remedy.
4. If the code is coming but not yet, `pending-refusal` with the ticket that will mint it, and lower `PENDING_REFUSAL_COUNT` when you drain it.

## How the numbers in this document were measured

At `a9c23dcdd`, `apps/server/src` holds 109 construction sites of `OrchestrationCommandInvariantError` — 87 direct `new`, 22 through the `invariantError` helper — of which 5 pass a non-literal reason, 37 are uncoded, and 26 of those are production (the rest are test fixtures). Two of the 26 are the bodies of `internalInvariantError` and `noShippedSurfaceInvariantError`, which do carry an exclusion and are invisible to a scanner that only reads `refusal`; one is test support. Separately, `decider/workItems.ts:51` funnels 18 throws through one uncoded factory. Re-run the census rather than trusting these numbers once the campaign starts moving.
