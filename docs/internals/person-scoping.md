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

| Phase | Ships                                                                                                                            | Gate                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 0 S1  | Owner side: pairing choice, principal on Connections rows, change action, one-time review banner                                 | click through                               |
| 0 S2  | Member shell, web and desktop: their group chats only, bot presentation subset, hidden owner entry points                        | click through                               |
| 0 S3  | Refusal and scope change: "Only the owner can do this", access-changed notice, chat leaving and appearing                        | click through                               |
| 0 S4  | Mobile: member home, member pairing screen                                                                                       | click through                               |
| 0 S5  | Owner side: group people list, full-access warning and acknowledgement; member leaves a group (decision-54)                      | click through                               |
| 1     | **Go** from Mohammad                                                                                                             | —                                           |
| 2     | PR 1a `feat/session-principal`: contracts, server, migration; Connections keeps sending `principal: 'owner'` and there is no UI  | security-architect review                   |
| 3     | PR 1b: the Connections UI from S1, wired to the real commands                                                                    | S1 frames                                   |
| 4     | PR 2 `feat/member-scope`: resolver, shell filter and stream, member table, command gate, work items, assets, recall, HTTP routes | security review; must land before invite UX |
| 5     | PR 3 `feat/member-client`: web, desktop and mobile screens replace the fixture source                                            | PR 2                                        |

Fixtures follow [the skills registry's seam rule](skills-registry.md#the-one-seam), so S4's mobile screens
gate the same way S1's web screens do: the machine and the fixture source take the flag as an argument and
each platform entry passes its own (web and desktop `import.meta.env.DEV`, mobile `__DEV__`). The S2–S4
screens must not exist in a production bundle while there is no enforcement behind them, because a switch
that does nothing next to security copy is worse than an absent screen. A dev-only picker drives the fixture
principal, so every frame state in TASK-171 is reachable without a server.

**One conflict to settle.** PR 1a is already assigned (TASK-164 notes, 2026-11-09) and predates the
screen gate in its current queue position. It changes no behaviour, since every session migrates to
owner, but it is a contracts and migration PR. Either Mohammad grants it an explicit exception, or
it waits behind phase 1 like everything else. The default in this plan is that it waits.

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

## Open questions

- **Q1** (Mohammad): may a member answer approvals (including `ask_user` questions) in their groups?
  Default until answered: no.
- **Q2** (Mohammad): does PR 1a get an exception from the screens-first gate, or wait? Default: wait.
- **Q3** (security-architect, already accepted): assigning a person into a group with a full-access
  bot warns and requires an acknowledgement naming those bots, and the same acknowledgement applies
  to adding a full-access bot to a group with people and to switching a group bot to full access.
- **Q4** (Mohammad, TASK-175 / decision-54): does a group member get a way to leave in v1? The plan
  allows `group.leave` for their own membership; the screens draw it unless he says no.
