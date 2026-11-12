# Person scoping

> For maintainers. Using IsnadiBot? See [remote access](../user/remote-access.md).

Pairing a second person today grants that person everything the owner has. A paired person with
standard scopes reads every chat, every bot and every thread, and can operate every bot, including a
full-access one. Group membership scopes nothing.

This page is the architecture for closing that: what a **member** session may read and operate, how
the server decides it, and the order the work ships in. Scopes themselves are in
[environment-auth.md](environment-auth.md); group membership is in [group-chats.md](group-chats.md).

## The gap, on main (d848db92)

- A person is an auth session. `personId` is an `AuthSessionId`, and the server fills it from the
  connection (`AuthenticatedCommand.ts`). Re-pairing creates a new person.
- The owner cannot be told apart from a paired person. Desktop and mobile request only the two
  orchestration scopes, so the owner's own phone holds standard scopes, exactly like a friend.
  `access:write` marks desktop-bootstrap and administrative sessions only.
- All 115 RPC methods map to one scope in `RpcAuthorization.ts` (`satisfies
Record<WsRpcMethod, AuthEnvironmentScope>`), and the two orchestration scopes reach every thread,
  every bot, settings, provider sign-ins, project files, computer and preview control, and every
  command in `dispatchCommand`, which also has an HTTP twin in `orchestration/http.ts`.
- `group.person.assign` already needs `access:write` and names a known client session
  (`canManageGroupPeople`, `applyKnownGroupPerson`), so membership exists. Nothing reads it.

## Decision: a session principal, deny by default for members

Each session carries `principal: 'owner' | 'member'`, separate from its scopes.

- **Owner** behaves exactly as today: no filter, no extra query, no payload change.
- **Member** reads and drives only the group chats they are a person member of, and only those
  groups' bots.
- Every RPC has an explicit member rule, and a new RPC fails to compile until someone classifies it.

Rejected alternatives: owner = `access:write` (locks the owner's phone out, or forces admin scopes
onto phones); a new scope such as `orchestration:all` (clients name their scopes, so current mobile
builds lose it at the next pairing); per-entity ACLs on threads, bots and projects (far bigger, and
groups are the only sharing model that exists); copy alone (TASK-163, interim only).

### Principal on links and sessions

- `AuthPrincipal = Literals('owner', 'member')` on `AuthPairingLink`, `AuthClientSession` and
  `AuthCreatePairingCredentialInput`; on the shell snapshot as `currentPrincipal`.
- A link without a principal from any caller becomes **member**: fail closed. The client never
  negotiates it.
- `desktop-bootstrap` and the `pair` CLI give owner: shell access to the box is ownership.
- A member link or session can never hold `access:read` or `access:write`; creating one fails with a
  typed error.
- The migration sets existing **sessions** to owner (no lockout; today's friends keep what they have)
  and unconsumed **links** to member (a pending link has no history to protect and may already be in
  someone else's hands). A one-time Connections banner then lists the non-admin sessions to review.
- `auth.session.setPrincipal({ sessionId, principal })` at `access:write` and owner principal is the
  way back in both directions. It closes the target's sockets **and** invalidates its HTTP bearer
  use, refuses to demote the caller's own session, and is audit-logged.

### The resolver

One function, `apps/server/src/auth/PersonScope.ts`, is the only place scope is computed:

```ts
type PersonScope =
  | { kind: "owner" }
  | { kind: "member"; personId: AuthSessionId; groupIds; threadIds; botIds };
```

- `groupIds` are the groups with a `{ kind: 'person', personId }` member; `threadIds` are those
  groups' threads; `botIds` are those groups' bot members.
- It is read from the projection once per connection, and recomputed on `group.person.assign` and
  `group.person.unassign`, `group.member.*`, `group.deleted`, `thread.created` and `thread.deleted`
  in those groups, and on a principal change.
- A decode or read failure gives an **empty member scope, never owner**.

## What a member reads

- **Shell snapshot.** `ProjectionSnapshotQuery.getShellSnapshot({ scope })` filters in SQL and
  returns the member's groups, their threads, and a **bot presentation subset** for those groups'
  bots: id, name, avatar, roleId, status. No instructions, access mode, model config, skills or
  channel bindings. Projects are the rows those threads reference, without the workspace path.
- **Live stream.** `wsOrchestrationSubscriptions.ts` drops any event whose thread, bot or group is
  out of scope, by set lookup before `liveBudget.retain`. When a member's scope changes, the stream
  ends with a typed `ShellScopeChanged` and the client resubscribes through its existing reconnect
  path: no in-stream diffing. Recompute and swap the scope before the next event is filtered, so an
  unassign fails closed.
- **Threads.** `subscribeThread`, `getTurnDiff` and `getFullThreadDiff` refuse out-of-scope thread
  ids; `searchThreads` filters its results; `assetsCreateUrl` serves only attachments of in-scope
  threads.
- **Work items** (`workItems.list`, `workItems.counts`, `workItems.get`) are scoped by the item's
  group, including the stream items.
- **Recall.** `recall.search` (TASK-76) uses the same resolver: the reader's candidates are
  intersected with `scope.threadIds`. Its current "owner" test becomes `principal === 'owner'`, and
  that edit belongs to TASK-76 and TASK-77.
- **Refusals are typed.** A member gets `RpcForbidden { method }`, not a 500.

## What a member operates

`authorizeMemberCommand(command, scope)` runs in **both** entry points, WS dispatch
(`wsOrchestrationHandlers.ts`) and HTTP dispatch (`orchestration/http.ts`), before the decider.

- Allowed, only on in-scope threads: `thread.turn.start`, `thread.turn.interrupt`,
  `thread.message.reaction.set`, `thread.responder.mention`, and `group.leave` for the member's own
  membership. Every other command type fails with `OrchestrationCommandForbidden`.
- `thread.turn.start` has a **field allowlist** for members: text and in-scope attachments only. A
  member cannot set runtime mode, access mode, provider, model, cwd, worktree, branch or any
  override the owner-only bot editor controls. `thread.responder.mention`'s target must be in
  `scope.botIds`.
- Approvals (`thread.approval.respond`) stay with the owner by default (decision-45); an approval is
  the owner's consent to a tool call on the owner's machine.
- Internal server and bot commands do not pass through this gate and are unchanged.

## The member table

`RPC_MEMBER_ACCESS satisfies Record<WsRpcMethod, 'owner-only' | 'scoped' | 'environment'>`, enforced
beside the scope check in `RpcAuthorization.ts`. Being exhaustive, it will not compile until a new
RPC is classified.

| Rule          | Methods                                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scoped`      | subscribeShell (filtered), subscribeThread, getTurnDiff, getFullThreadDiff, searchThreads, assetsCreateUrl, dispatchCommand, recall.search, workItems.list/counts/get               |
| `environment` | serverProbe, serverGetConfig, subscribeServerConfig, subscribeServerLifecycle, serverReportClientActivity, attachmentsCreateUploadUrl                                               |
| `owner-only`  | everything else: settings, providers, subscription auth, composio, voice, memory, portability, project files, computer, preview, telemetry, diagnostics, routines, inbox, bot usage |

- The `environment` methods return a **member projection**, and the contract names the member fields
  as an allowlist, so a field added later is hidden by default. Provider accounts, host paths and
  settings never reach a member.
- `attachmentsCreateUploadUrl` is bound to an in-scope thread and rate limited per member session;
  without that it writes to the owner's disk.
- HTTP entry points get the same treatment: every route under `/api`, the preview and computer HTTP
  surfaces and `oauth` carries a classification, and a test walks the router so a new route without
  one fails.

## Clients

Member mode is a rendering decision over the same contracts. In `packages/client-runtime`:

- the one seam is `auth/memberScope.ts`, exposing `useSessionPrincipal()` and the member shell
  selectors. Screens never read `RpcForbidden` or the principal from anywhere else.
- A member renders only their groups' chats, uses the bot presentation subset, and hides owner-only
  entry points (Settings beyond device and app, the bot editor, projects, palette actions).
- `RpcForbidden` renders as "Only the owner can do this"; `ShellScopeChanged` renders as a short
  access-changed notice with the way back.
- The owner side gains the pairing choice ("Your device" / "Another person", no default), the
  principal on each Connections row with a change action, the one-time review banner, and the group
  people list that names full-access bots and takes `acknowledgedFullAccessBotIds` before an assign.
  The warning says what full access means: code execution on the owner's machine as the owner's user.
  The server refuses an assign whose acknowledgement is missing or wrong, so a raw RPC client cannot
  skip it.

## Build order: screens first

**Decision-53** applies: the screens ship on fixtures first, and no contracts, server or migration PR
for this feature starts until Mohammad has clicked through and said go. Frames are TASK-171
(designer).

| Phase | Ships                                                                                                                             | Gate                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 0 S1  | Owner side: pairing choice, principal on Connections rows, change action, one-time review banner                                  | click through                               |
| 0 S2  | Member shell, web and desktop: their group chats only, reduced Settings, hidden owner entry points                                | click through                               |
| 0 S3  | What a member sees when something is the owner's: bot presentation subset, refusal, access-changed notice, chats coming and going | click through                               |
| 0 S4  | Mobile: member home, member pairing screen                                                                                        | click through                               |
| 0 S5  | Owner side: group people list, full-access warning and acknowledgement; member leaves a group (decision-54)                       | click through                               |
| 1     | **Go** from Mohammad                                                                                                              | —                                           |
| 2     | PR 1a `feat/session-principal`: contracts, server, migration; Connections keeps sending `principal: 'owner'` and there is no UI   | security-architect review                   |
| 3     | PR 1b: the Connections UI from S1, wired to the real commands                                                                     | S1 frames                                   |
| 4     | PR 2 `feat/member-scope`: resolver, shell filter and stream, member table, command gate, work items, assets, recall, HTTP routes  | security review; must land before invite UX |
| 5     | PR 3 `feat/member-client`: web, desktop and mobile screens replace the fixture source                                             | PR 2                                        |

### Phase 0 slices

One card per slice, in this order. Each is reviewable on its own: Mohammad clicks one through, and the
next can start while he looks. Frames are TASK-171's, and the state column is what exists in Figma
today.

| Slice | Ships                                                                                                                                                                                                            | Frames                                         | Drawn                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------- |
| S1    | Owner side: "Your device / Another person" in the pairing dialog, the principal on each Connections row, the change action both ways, the one-time review banner                                                 | F1a–F1e, F2 rows and confirms, G1              | light; dark and RTL outstanding           |
| S2    | Member shell, web and desktop: their groups' chats only, reduced Settings (device and app), no owner entry points, no owner palette actions                                                                      | F3 ×5 states, member settings                  | light; dark and RTL outstanding           |
| S3    | A member where the owner acts: bot presentation subset, an approval waiting that they cannot answer, "Only the owner can do this" inline and as a toast, the access-changed notice, a chat leaving and appearing | F5, F6, F7                                     | light; dark and RTL outstanding           |
| S4    | Mobile: member home, reduced Settings, and the member's own pairing screen                                                                                                                                       | F4 ×5 states, F8 (seven `PairingPanel` states) | F4 and F8 light; dark and RTL outstanding |
| S5    | Group people list naming the full-access bots, the acknowledgement before an assign, the three reverse cases, the member's own leave                                                                             | G2, G3                                         | **not drawn**; G3 waits decision-54       |

Mohammad is creating the S1 and S2 cards; this table is what each card will say.

Every frame S1, S2, S3 and S4 needs now exists in light, so all four can start; dark and RTL are still
outstanding everywhere, and **G2** is the only light frame left to draw (G3 waits decision-54, so S5
still cannot start). S3's frames landed in the order asked for — F6 and F7 first, then F5 — which is
what let S3 begin before the member shell was finished. When S1 lands its dev principal bar, S4 can
start on F4 in parallel.

S2 and S3 split where they do on purpose. The earlier sketch had the bot presentation subset in S2,
which would have held the whole member shell on F5. F5's states — waiting on an approval a member
cannot answer, unreachable — are refusal states, and they belong beside F6.

### S3 in detail: what a member sees when the owner acts

S3 is the slice where a member meets something that is not theirs. It runs on fixtures like S1 and S2;
it needs no server principal and no contract change.

**The bot presentation subset.** The shell snapshot carries one entry per bot in the member's groups:
`{ botId, name, avatarUrl, roleId, status }`. It is an allowlist contract, not a projection of the bot
record: a field added to the bot engine later is absent for a member by default, and the test that
walks the struct is what keeps it absent. Instructions, access mode, model and fallback config,
skills, channel bindings, connectors and usage describe the owner's machine, not the member's
conversation, and never enter it.

**The approval a member cannot answer is the sharp edge.** Today's pending approval
(`packages/client-runtime/src/pendingRequests.ts`) carries `detail`, `toolName` and raw `args`, filled
from the provider runtime's `request.opened` payload
(`packages/contracts/src/providerRuntime/requestEvents.ts:21`). `args` is often `{ command: "…" }`: the
owner's command line, and through it paths, hosts and sometimes credentials. A member's copy of the
thread therefore cannot be the owner's copy with the buttons hidden.

The rule: **redact where the event is projected, never in the screen.** The one seam is
`apps/server/src/orchestration/ActivityPayloadProjection.ts`, which already projects activities once
for the wire; it becomes principal-aware there, and `packages/contracts` declares the member-projected
activity payload as a **field allowlist** — the same rule the `environment` methods follow, so a field
added later is hidden for a member by default. A screen cannot be trusted to hide what reached its
socket: a hand-built client reads whatever the server sent, so UI-only hiding is fail-open. The
member's card reads "<Bot> is waiting for the owner to approve an action" with no answer controls; the
owner's card is unchanged.

The leak is wider than the approval. `tool.started` and `tool.updated` activities carry the command
line (`data.command`), absolute changed paths (`data.files`) and `data.rawOutput`, and
`pendingRequests.ts:160,195` merges `data.args ?? { command: data.command }` from `tool.started` into
the approval by request id — so redacting the approval activity alone still leaves the member's card
reading the command. **The member projection carries no `requestKind` either**: telling `command` from
`file-read` from `file-change` is a side channel on the owner's work in a group whose members cannot
act on it (decision-45). The member's card says "the owner is needed here" from a client-side constant
over the projected record; going finer later is one field. This is TASK-190, severity HIGH, and its
redaction is a **merge gate on the PR that makes `subscribeThread` member-reachable** — not live today,
because no member principal exists yet.

**A refusal must not be an oracle.** `RpcForbidden { method }` is the typed refusal, and it must be
identical for a thread id that exists but is out of scope and for one that never existed. Answering
NotFound for the second and Forbidden for the first hands a member an id-enumeration oracle over the
owner's chats. One shape, one status, on the WS and HTTP entry points alike. In the UI the inline
reason ("Only the owner can do this") sits on the control that refused; an attempt against a stale
control ends as a toast. Both read from `memberScope`'s selectors, never from a screen parsing an
error.

**The access-changed notice has to be reversible.** A scope change ends the stream with
`ShellScopeChanged`, the client resubscribes through its existing reconnect path, and the notice says
what changed in the owner's words with the way back to their shell home. Three reverse states S3 owes:
a chat removed while it was open renders the removed-elsewhere state with the way back rather than a
stale thread; a chat that appears does not steal focus or reorder under the member's cursor; and a
member whose access is restored sees the group again without a reload.

**Fixture states.** S2's dev principal bar gains the states S3 is judged on:
`member-pending-approval` (a request opened on an in-scope thread), `member-refused` (a control the
member may not use) and `member-scope-changed` (removed while open), beside the existing owner, member
and member-removed. Each is a fixed tick with no timers, so a screenshot comparison is stable.

**Not in S3:** inviting people, the group people list, full access and its acknowledgement (S5), the
member's own leave (decision-54, G3), and anything that needs the server principal (PR 2).

**Tested by:** the redacted member projection (a `request.opened` reaching a member carries no `args`,
`detail` or `toolName`), the refusal shape for a nonexistent id matching the one for an out-of-scope
id, and the resubscribe path on `ShellScopeChanged`. Contract and projection tests live with PR 2; S3
carries the fixture and rendering tests.

### The fixture seam

`packages/client-runtime/src/auth/memberScope.ts` is the only place a screen learns who is looking.
It exports `useSessionPrincipal()` (returning `owner`, `member` or `unavailable`) and the selectors
the shell reads: the member's groups, their chats, the bot presentation subset, and whether a member
may do a given thing. No screen reads the principal from anywhere else. Phase 0 has no server
principal, so the module's source is a fixture, and PR 3 replaces the source without touching a screen.

Until `packages/contracts/src/auth.ts` carries `AuthPrincipal`, the module declares its own `Principal`
type, field for field with [Principal on links and sessions](#principal-on-links-and-sessions), and a
comment saying to delete it when PR 1a lands. The swap stays mechanical.

The gate follows [the skills registry's seam rule](skills-registry.md#the-one-seam), which S4's mobile
screens need as much as S1's web ones: the machine and the fixture source are plain modules that read
no platform global and take the dev flag as an argument. `createMemberScopeFixture({ dev })` returns
an empty source when `dev` is false; web and desktop pass `import.meta.env.DEV` and mobile passes
`__DEV__`; `useSessionPrincipal` reports `unavailable` when no source is registered.

**A screen given `unavailable` renders nothing, and so does the navigation row that owns it.** The
same goes for S1's owner-side additions: the pairing dialog shows today's dialog, unchanged. Nothing
a member can see and no security copy reaches a shipped build while nothing enforces them, because a
switch that does nothing is worse than an absent screen.

**The dev principal bar** is the one piece of chrome the slices add that is in no frame: a small chip
reading `dev · owner` that cycles `owner → member (in groups) → member (removed from a group) → owner`,
and with the middle two a switch that makes the next action return a refusal. It sits under the seam,
not in a screen, never appears in a frame, and disappears with the fixture source in PR 3. It is what
makes every frame state reachable without a server, and S1 is where it gets built.

Each slice's fixtures cover every state in that slice's frames and nothing beyond them.

### What PR 1a waits for

PR 1a is `feat/session-principal`: contracts, the principal on links and sessions, the migration, and
no UI. It needs no frame. Four things stood between it and a branch; the first is now settled and the
other three are logistics.

1. **The screens-first gate (Q2, answered).** No exception. Decision-53 holds PR 1a like any other
   contracts and migration PR, so it waits behind the screens-first go and needs no decision of its
   own.
2. **The work already written.** `.claude/worktrees/per-person-scoping` holds 27 uncommitted files
   against the contracts and the `EnvironmentAuth*` family (~550 lines) on a base at #144, and
   `feat/session-principal` exists with no commits ahead of main. Engineer-2 lands or drops that
   worktree after TASK-181; a second pass before then collides with it.
3. **The migration number.** The card's notes say 078 is the last migration on main. Main is at 080
   (`080_ProjectionWorkItems.ts`) and 081 is claimed by the shard-4 SQLite repair, so PR 1a takes
   whatever is next free when it starts.
4. **The audit.** `auth.session.principal-changed` is a kind reserved on TASK-95, which is Backlog.
   `setPrincipal` must not depend on an audit service that does not exist: it either emits the kind
   through the existing event log or leaves the call site marked for TASK-95. The card's "once TASK-95
   is on main" clause already covers the assign and unassign pair the same way.

PR 1b does need frames — F1 and F2, which are drawn in light, so it waits on Mohammad's click-through
of S1, not on the designer. PR 2 needs 1a and the security-architect's review, and must land before
any invite-a-person UI (decision-46).

## What must not change

- The owner's path: no filter, no extra query, no change to shell payload size or latency (golden
  snapshot test).
- The scope strings and the token exchange's negotiation.
- The access every existing session has; all of them migrate to owner.
- Channel members (Slack, Telegram), who are not sessions.
- Internal bot and reactor commands.

## Tests

- **Migration and principal:** existing sessions become owner, unconsumed links become member, a link
  without a principal becomes member, a member link with an access scope is refused, exchange copies
  the principal, `setPrincipal` closes sockets and HTTP bearer use and refuses self-demotion.
- **Resolver:** a member resolves their groups' threads and bots; a resolver failure gives an empty
  scope; an unassign interleaved with a thread event never delivers that event.
- **Shell:** a member snapshot holds only their groups, threads and bot subset, and no workspace
  path; the owner snapshot is byte-identical to before; assign and unassign end the stream with
  `ShellScopeChanged`, and the resubscribe shows the new scope.
- **RPC table:** table-driven from `RPC_MEMBER_ACCESS`, plus a type-level exhaustiveness check; the
  member projections of `serverGetConfig` and `subscribeServerConfig` are checked field by field.
- **Commands:** each allowed type passes in scope and is refused out of scope, on WS and HTTP; every
  other type is refused; a forged `threadId` outside scope is refused; a forged `thread.turn.start`
  payload is refused.
- **Perf:** a member shell over 5k threads and 10 groups is within 10% of the owner's snapshot p95,
  and the per-event filter cost is measured in the existing shell perf test.
- **Member thread projection** (TASK-190, PR 2 review checklist). `subscribeThread` and every snapshot
  derived from it project activities through the member allowlist before serialization. With a member
  principal, nothing in the frame carries `tool.started` / `tool.updated` `data.command`, `data.args`,
  `data.files` or `data.rawOutput`, nor `approval.requested` `payload.args`, `detail`, `toolName` or
  `requestKind`. Assert on the serialized frame, not the view, for four cases: a command turn, a
  file-change turn, the pending approval as `derivePendingRequests` builds it (its args arrive from
  `tool.started`), and a product-feedback or routine approval whose args are decoded structures. Owner
  frames stay byte-identical to today.

## Open questions

- **Q1** (Mohammad): may a member answer approvals (including `ask_user` questions) in their groups?
  Answered by decision-45: no, and S3 draws it that way.
- **Q2** (Mohammad): does PR 1a get an exception from the screens-first gate, or wait? Answered: no
  exception; decision-53 stands and PR 1a waits behind the screens-first go. No board decision is
  being drafted for it. [What PR 1a waits for](#what-pr-1a-waits-for) lists the rest.
- **Q3** (security-architect, already accepted): assigning a person into a group with a full-access
  bot warns and requires an acknowledgement naming those bots, and the same acknowledgement applies
  to adding a full-access bot to a group with people and to switching a group bot to full access.
- **Q4** (Mohammad, TASK-175 / decision-54): does a group member get a way to leave in v1? The plan
  allows `group.leave` for their own membership; the screens draw it unless he says no.
