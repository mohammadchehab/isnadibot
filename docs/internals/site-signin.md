# Site sign-in

> For maintainers. Design for the site sign-in flow: the chat card, Settings › Signed-in sites, the
> palette actions, and the server state behind them (TASK-130, 131, 132, 136, 137, 141).
> Using IsnadiBot? See [docs/user](../user/).

A bot that needs a signed-in site asks the owner. The owner signs in once, from a card in the chat, in
Isnadi's own form: a login agent reads the site's page and the server types the answers into the browser,
so the owner never types a password into a page a bot can see. IsnadiBot keeps the session encrypted, the
bot reaches the site only through a grant, and for a site routed through the owner's PC the desktop decides
which hosts leave the machine.

Decisions this design must satisfy: D6 (store passwords, so a site can be signed in again automatically),
D7 (form first; the live view is the fallback for CAPTCHAs and odd pages), D8 (native form sheet on
mobile), D52 (the inbox's Handled row is transient), decision-53 (screens before backend).

**Naming.** TASK-24, 25, 27 and 34 point at `docs/internals/browser-auth.md`. This file is that document;
nothing else should be created under the old name.

## Goal

- One sign-in, from wherever it starts: a bot's request in a chat, Sign in again on a saved site, or the
  palette. It is one flow, one form, one result.
- The owner always knows what state the sign-in is in and can always stop it. Every way in has a way out.
- A saved session is the owner's. A bot reaches the site only because the owner said so, for that bot, that
  thread and that site, and that permission ends on sign-out.
- Nothing secret reaches a model, a transcript, a log or a client: no cookies, no typed value, no profile
  path. The card reads names and states.

## The three permissions

They look alike and are constantly confused. Keeping them separate is most of this design.

| Permission        | What it allows                                          | Who sets it                    | What it is not                   |
| ----------------- | ------------------------------------------------------- | ------------------------------ | -------------------------------- |
| **Profile**       | the server holds this site's session, encrypted at rest | the owner, by signing in       | not access for any bot           |
| **Session grant** | this bot, in this thread, may use that profile          | the owner, on the card's Allow | not a host allowlist             |
| **Egress grant**  | this profile may reach this host through the owner's PC | the owner, in the desktop's UI | not a session, and never a bot's |

A sign-in creates a profile and nothing else. A bot's request that is approved creates a session grant. An
egress grant exists only on the desktop, only for PC-routed sites, and only when the owner typed or
confirmed the host there. No bot, page or renderer can create either grant, and an approved auth host never
creates an egress grant (TASK-34 AC5).

## States

### The request (server state)

The decider owns these. There is no `cancelled` state: Cancel on a bot's request returns it to `asking`,
Cancel on an owner-started request ends it as `dismissed` (no bot is waiting on those), and Not now is the
only decline.

| State         | Meaning                                                                     | Terminal |
| ------------- | --------------------------------------------------------------------------- | -------- |
| `asking`      | the owner has been asked; no flow has started                               | no       |
| `in_progress` | one flow exists, named by `flowId`, with `startedBy`; carries `submitting`  | no       |
| `signed_in`   | a profile was saved at `generation + 1`, or an `access` request was allowed | yes      |
| `failed`      | the flow ended with a failure class                                         | yes      |
| `dismissed`   | the owner pressed Not now, or cancelled a request of their own              | yes      |
| `expired`     | nobody answered, or the turn that was waiting ended                         | yes      |

`kind` is `sign-in` (no usable profile) or `access` (a signed-in profile exists that this bot and thread do
not cover; the card is a question with Allow and Not now, no form). The row also carries `requested_by`,
`start_url`, `failure_class`, `asking_elapsed_ms`, `asking_since` and `settled_at`, and no `expires_at`:
expiry is computed by the rules below, so it cannot drift from the clock that matters.

### The card (what the owner sees)

Frames live in Figma "States / Sign-in card" (2103:275).

| Card                   | Frame                   | Shown when                           | Actions                   |
| ---------------------- | ----------------------- | ------------------------------------ | ------------------------- |
| Asking                 | 2103:279                | `asking`                             | Sign in, Not now          |
| Asking for access      | —                       | `asking` with kind `access`          | Allow, Not now            |
| Signing in             | 2182:1271               | `in_progress`, not submitting        | Cancel, Continue sign-in  |
| Finishing sign-in      | —                       | `in_progress`, submitting            | none; Cancel is refused   |
| Signed in              | 2103:328                | `signed_in`                          | none                      |
| Not signed in yet      | E3c                     | the signed-in check did not hold     | Keep the flow, Save again |
| Failed: asks you       | 2103:455                | `failed`, no saved password          | Sign in again             |
| Failed: password saved | 2112:865                | `failed`, a saved password exists    | Sign in again             |
| This request expired   | Not-now style, 2103:420 | `expired`                            | none                      |
| Waiting for your PC    | 2103:376                | PC-routed site, egress check pending | Retry, Not now            |
| Not now                | 2103:420                | `dismissed`                          | none                      |

The form the card opens is E3a (2154:1239) reading, E3c (2154:1521) signed in; on mobile the native sheet
is E7d (2160:1238). The card's own copy is plain text, including the bot's `reason`; the site is the
largest element and is shown as the normalized registrable domain, with an IDN always in punycode.

### Transitions

| From          | To            | Trigger                                                                   | Guard                                                                       |
| ------------- | ------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `asking`      | `in_progress` | Sign in                                                                   | compare-and-set on `asking`; one in-progress per request                    |
| `in_progress` | `in_progress` | a second client's Sign in                                                 | joins the existing flow as Continue sign-in, never a new one                |
| `in_progress` | `in_progress` | flow reaches submitting                                                   | Cancel is refused from here on                                              |
| `in_progress` | `asking`      | Cancel on a bot's request, or the flow is abandoned                       | not submitting; the asking clock resumes, it does not restart               |
| `in_progress` | `dismissed`   | Cancel on an owner-started request                                        | not submitting; no bot is waiting, so there is no asking state to return to |
| `in_progress` | `signed_in`   | the save at `generation + 1` is accepted                                  | the save is a compare-and-set on the generation                             |
| `in_progress` | `failed`      | the flow ends with a class                                                | `in-use`, `signed-out-meanwhile`, `vault-disabled`, `signed-out`            |
| `asking`      | `dismissed`   | Not now                                                                   | any client                                                                  |
| `asking`      | `expired`     | the wait limit, turn end, interrupt, thread delete, bot archive or delete | never cuts a flow                                                           |
| `failed`      | `in_progress` | Sign in again                                                             | same compare-and-set as a first start                                       |
| `signed_in`   | —             | sign out                                                                  | writes the tombstone, see below                                             |

The precedence rule is the important half:

- **The first terminal event wins.** A completion that arrives after `dismissed` or `expired` is dropped: no
  profile is saved, and the bot is told the owner declined or did not answer.
- **`submitting` beats Cancel.** Once the form is submitted the result stands, even if Not now was pressed on
  another client; the card shows Finishing sign-in rather than pretending to have stopped.
- **One flow per request, and a completion belongs to its flow.** A start is compare-and-set on `asking`, so
  two clients pressing Sign in produce one flow: the second joins it as Continue sign-in and is never a
  second flow over one profile. Every completion names the `flowId` it was started for and is applied only
  while that id is the request's current flow. After Cancel ended that flow the request is back at `asking`
  with no current flow, so its late completion is dropped, and a later Start's flow is never satisfied by
  an earlier flow's result.
- **`submitting` is a window, not a lock.** It clears on the submit's result, or when the flow service's
  step timeout dispatches `submit-settled`, whichever comes first; Cancel works again afterwards, and a
  completion that arrives after a timed-out settle and a Cancel is dropped by the same `flowId` match.
- **An in-progress flow is never cut by expiry.** Turn end, interrupt and thread delete expire `asking`
  requests only. A flow that finishes after its turn ended still saves the profile and posts a settled line
  in the chat, because the owner chose to sign in; the bot is not resumed.

## The command and RPC surface

Two surfaces, split by what they carry. A **request** is durable state, so it changes by orchestration command:
the decider owns the state machine, every change is audited, and a replay is refused. A **flow** is the live form,
so it is an RPC: it streams page state and carries typed answers that must never reach an event, a transcript or a
log. Nothing else writes either one (TASK-27; the client seam is `packages/client-runtime/src/browserAuth/`).

### Client commands

All are dispatched through `orchestration.dispatchCommand` at `orchestration:operate`, and all are **owner-only for
a member principal**: owner is the session principal, not `access:write`.

| Command                                                 | Does                                                                                                        | Refused when                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `browser-auth.request.start { requestId }`              | `asking` → `in_progress`, compare-and-set, mints the flow id                                                | not `asking`; an expired request; a flow is open                  |
| `browser-auth.request.start-owner { site, profileId? }` | creates the owner's own request (no bot, no thread) and opens its flow                                      | the site already has an open request                              |
| `browser-auth.request.cancel { requestId }`             | back to `asking` with the clock resumed; an owner-started request is dismissed instead                      | `submitting`                                                      |
| `browser-auth.request.dismiss { requestId }`            | Not now: the only decline                                                                                   | a flow is open                                                    |
| `browser-auth.request.allow { requestId }`              | kind `access` only: the decider writes the session grant for (profile, bot, thread) and settles `signed_in` | kind `sign-in`; the grant already exists; the profile is not live |
| `browser-auth.grant.revoke { grantId }`                 | revoke one bot's access                                                                                     | a bot principal, or a grant it does not hold                      |
| `browser-profile.sign-out { profileId }`                | the tombstone at `generation + 1`                                                                           | —                                                                 |
| `browser-profile.delete { profileId }`                  | remove the row and its ciphertext                                                                           | a flow is open on that profile                                    |

**Allow is the only client path to a grant.** `browser-auth.grant.create` stays internal, next to
`browser-auth.request.create`, `.complete`, `.fail`, `.expire`, `browser-profile.save` and `.health-recorded`: they
are not in `ClientOrchestrationCommand`, so no client and no bot tool can mint one. The client asks to allow a
request it was shown and the decider resolves that into a grant. One request yields at most one grant; a replayed
Allow is refused.

### RPCs

Only the live form is an RPC, plus the one server-side routing decision. All are registered in TASK-27 with their
input schemas and `RPC_REQUIRED_SCOPES` entries, owner-only in `RPC_MEMBER_ACCESS`, and the `WS_METHODS`
enumeration test fails if one is missing.

| RPC                               | Scope                   | Handler lands in |
| --------------------------------- | ----------------------- | ---------------- |
| `browserAuth.flow.watch` (stream) | `orchestration:operate` | TASK-35          |
| `browserAuth.flow.submit`         | `orchestration:operate` | TASK-36          |
| `browserAuth.setProfileRoute`     | `access:write`          | TASK-27          |

There is no `flow.start` and no `flow.cancel` RPC: starting and cancelling are the commands above, so a start is one
audited state change rather than a second write path with its own authorization. A flow RPC never creates a profile,
a grant or a host grant; it only moves a flow the decider already opened. `submitting` is set by the internal command
the submit handler dispatches, so the decider stays the only writer.

### The request view

The view the card reads is the record `deriveSiteSignInCard` takes, and the server schema is the same shape
(camelCase over the columns named above):
`requestId`, `threadId`, `botId`, `site`, `kind`, `state`, `reason`, `startUrl`, `submitting`, `failureClass`,
`hasSavedPassword`, `pcRouted`, `egress`, `checkFailed`, `askingElapsedMs`, `askingSince`, `settledAt`, and
`profileId` on an owner-started request (so the inbox item in TASK-133 can match an open request to its profile). No
`expiresAt`: expiry is computed from `askingSince` and `askingElapsedMs` by the rules below, and a second stored
deadline would be a second clock. No cookie, typed value, profile path or generation is in it.

### Site identity

`site` is the registrable domain of the host, already punycode when it is an IDN, computed by one shared function in
`@isnadi/shared/siteDomain` that every surface calls: TASK-26's `UNIQUE(site)` column, TASK-27's decider, the
`startUrl` check, TASK-34's cookie filter, TASK-50's health check and the desktop's egress store. It must resolve
public suffixes with private domains included (`getDomain(host, { allowPrivateDomains: true })`), so `foo.github.io`
and `bar.github.io` are two sites and neither collapses into `github.io`. Today's exports there are `normalizeHost`
and `hasRegistrableDomain` only; TASK-140 AC7 owns adding the identity function, and it lands before TASK-27, which
reuses it rather than growing a second copy.

## The profile and the session

- **One profile per site** (`UNIQUE(site)`), and one ciphertext file per generation under
  `<stateDir>/browser-profiles/<profileId>.<generation>.enc`. The payload is a Playwright storage state;
  the key is per-profile, derived from the vault master key, and never stored beside the file.
- **A generation** is a monotonic integer on the profile row. Every write says which generation it started
  from and is refused if that is not current. This is what stops a late save or a health check from
  resurrecting a profile the owner just signed out of.
- **Sign out writes a tombstone** at `generation + 1`: ciphertext deleted, every session handle revoked, the
  saved vault password removed, the row kept. A fresh sign-in starts from the tombstone's generation, so a
  flow that began before the sign-out can never win. Tombstones stay in the shell for 24 hours, so Check and
  Sign in again can say "this site is signed out" instead of failing with an unknown profile.
- **A lease** gives one writer exclusive use of a profile (30 s TTL, 10 s heartbeat, takeover only after it
  expires, and a fencing token). The lease makes concurrent use safe; the generation makes concurrent
  writes safe. They are not substitutes.
- **What the card reads** is the request view: site, kind, state, failure class, the normalized start origin
  and whether a saved password exists. It never reads the profile's ciphertext, its cookies, its auth hosts'
  cookies or the generation; those exist on the server and nowhere else.
- **The auth-check URL** is fixed by the owner at sign-in and is the only URL a health check may fetch. A
  bot-supplied `startUrl` is used only for a fresh sign-in with no saved state, never on a re-sign-in.

## Allowed hosts: the permission boundary

For a site routed through the owner's PC ([egress](egress.md)), a request for a host that is not granted is
refused before any DNS or TCP, and the owner is asked to approve that exact host. The boundary has four
parts, and all four are load-bearing:

1. **The grant store is the desktop's**, in the desktop's state directory, mode 0600, fail closed: an
   unreadable file denies everything until the owner resets it.
2. **The binding is the desktop's.** Each control connection is bound to the profile ids the owner allowed
   for that environment. The server's `profileId` on an `open` frame is checked against it, so a compromised
   or remote environment cannot borrow another profile's grants.
3. **Grants are per profile and per host.** Exact or wildcard on a label boundary, never matching an IP, and
   a grant is not an address allowlist: a granted name that resolves to a private or metadata address is
   still refused, on every dial.
4. **Revoke is the way out** and takes effect at once: a revocation publishes, and the provider re-evaluates
   live streams of that profile and ends the ones no longer allowed, including a dial in flight.

The sign-in card meets this boundary in two places. A PC-routed sign-in that the desktop refuses with
`host-not-granted` raises one native confirm for that exact host, once per host per flow, in the desktop's
own process; cancelling leaves it refused and does not ask again in that flow. And "Waiting for your PC"
is not an error state to click through: it means the egress self-check did not answer in 5 seconds, after 2
minutes the session ends, and resuming re-runs the check instead of trusting the earlier answer.

## Re-check and expiry

| Clock                        | Value                                                          | What it does                                                       |
| ---------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| Bot waiting for an answer    | 10 min while `asking`                                          | the tool returns "owner did not answer"; the request expires       |
| Asking clock across a Cancel | resumes, not restarts                                          | repeated Cancels cannot keep a bot waiting                         |
| Abandoned flow               | 5 min in awaiting input or human; 10 min in external action    | the request returns to `asking`, or to `expired` if the turn ended |
| Egress self-check            | 5 s                                                            | Waiting for your PC                                                |
| Waiting for PC session       | 2 min                                                          | the session ends with "Your PC is offline"                         |
| Lease                        | 30 s TTL, 10 s heartbeat                                       | takeover only after expiry; self-fencing at 20 s                   |
| Tombstone in the shell       | 24 h                                                           | after that the site leaves the list entirely                       |
| Session grant                | until sign-out, profile delete, bot removal, or 30 days unused | a handle use refreshes it                                          |

Health is a boolean: `ok`, `expired` or `unknown`. The check runs inside the profile's own route, holds the
lease, fetches only the stored auth-check URL, re-resolves the host and classifies every address before
connecting (so a DNS rebind after save is closed), stores no page text, and writes at the generation it
started from. A check that meets `LeaseHeld` is skipped and records nothing: the profile is in use, which
proves nothing about health.

An `expired` result may start one automatic re-sign-in, and only when the owner saved a password for that
profile at its current generation (D6, TASK-30). It runs at most once per expiry episode; until the profile
has been `ok` again, no further automatic attempt happens, so a wrong password cannot be retried into a lockout.
Without a saved password the owner is asked, with the normal card. Sign out deletes the password, which is
the way out.

## The tables and the events

TASK-26 adds five tables; three that the original story asked for are deliberately absent. The columns live on that
card (its consolidated table list supersedes the older one in the same brief); what is decided here is what exists,
what a row is for, and which constraints are load-bearing.

| Table                               | One row per            | Load-bearing                                                                                                                                                                                                                                                  |
| ----------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projection_browser_profiles`       | site                   | `UNIQUE(site)`; a tombstone is the same row at `g+1`, reused on re-sign-in, never a second row; holds generation, status, health, route, `auth_hosts`, `last_write_id`; no ciphertext and no path                                                             |
| `projection_browser_auth_requests`  | request                | no `expires_at` and no `cancelled`; `requested_by` is `bot` or `owner`, and a bot request must carry bot, thread and `tool_call_id`; carries `kind`, `start_url`, `failure_class`, `submitting`, `flow_id`, `asking_elapsed_ms`, `asking_since`, `settled_at` |
| `projection_browser_session_grants` | (profile, bot, thread) | `UNIQUE(profile_id, bot_id, thread_id)`, so an approval cannot stack; expiry is derived from `last_used_at`; no FK to bots or threads, the projector deletes them on archive, delete, group removal and thread delete                                         |
| `browser_profile_leases`            | profile                | `fencing_token` only ever grows, and release keeps the row                                                                                                                                                                                                    |
| `browser_profile_checks`            | profile                | the last `result` plus the `expiry_episode` and `auto_resign_episode` counters                                                                                                                                                                                |

**What is deliberately not a table**, and why:

- **`connections`**: the story's "auth connections" are Kernel Managed Auth, which no card in this stack uses. It
  gets a table with its first user.
- **`flows`**: a flow's live state — the page's fields and the answers typed into them — is in memory only
  (TASK-35, TASK-36). What persists is the request and its state. A flow table would be the one place a typed value
  could reach a row.
- **`egress_providers`**: the provider is the desktop's existing egress-provider pairing grant, whose token is
  already hashed there. The server holds no egress token, so a profile only records its `route`.
- **`events`**: browser-auth changes are orchestration events like every other kind, not their own log. The chat
  line for a settled request is a thread activity, not a shell field.

Ciphertext is on disk, never in a row: `<stateDir>/browser-profiles/<profileId>.<generation>.enc`, with the path
derived from the brand-checked id and the generation — which is why no url, cookie, token, key or path column exists
anywhere (TASK-26 AC1). The migration takes the next free number at build time; `080_ProjectionWorkItems` is the
latest on main today, so it is `081`.

### The events

Every accepted browser-auth command appends exactly one orchestration event, named with the existing dotted
`noun.verb` kinds, and the projector writes the rows above from them.

| Event                             | Carries                                                                |
| --------------------------------- | ---------------------------------------------------------------------- |
| `browser-auth.request.created`    | requestId, site, kind, state; threadId and botId on a bot request only |
| `browser-auth.request.started`    | requestId, flowId, startedByClient                                     |
| `browser-auth.request.submitting` | requestId                                                              |
| `browser-auth.request.reopened`   | requestId (back to `asking`; `asking_since` resumes)                   |
| `browser-auth.request.settled`    | requestId, state, site, failureClass when failed                       |
| `browser-profile.saved`           | profileId, site, generation, status                                    |
| `browser-profile.signed-out`      | profileId, generation                                                  |
| `browser-profile.deleted`         | profileId                                                              |
| `browser-profile.health-recorded` | profileId, result — only when the value changed                        |
| `browser-profile.route-changed`   | profileId, from, to                                                    |
| `browser-session-grant.created`   | grantId, profileId, botId, threadId, site                              |
| `browser-session-grant.revoked`   | grantId                                                                |

The payload rule is the one the card states and a schema test enforces: ids, site, state, route names and
timestamps only. No URL with a query, no cookie, no typed value, no path, and the auth-check URL appears in no event
except the profile save that stores it. A settled request also appends one thread activity,
`browser-auth.request.settled { requestId, state, site }`, so the chat card keeps its final state after the request
leaves the shell.

There is no `AuditKind` on main yet (TASK-95 is unstarted), so nothing here invents one: the names are chosen to map
1:1 onto the audit kinds TASK-95 will define — `browser-profile.route-changed` becomes `profile.route-changed`, and
so on — so no rename is needed later.

## What must not change

- The vault boundary: no typed value, cookie or storage state in an event, transcript, tool result, log,
  span or client payload. The card reads names.
- The `.isnadi` data boundary: profiles, grants and logs live under the Isnadi home, never `~/.t3`.
- The card is one flow. Sign in again, the palette and the inbox item all open it; none of them is a second
  sign-in path with its own state.
- An egress grant never comes from a bot, a page or a renderer, and a wildcard is never inferred from a
  string the server or a bot produced.

## Security

For the security-architect. The threat is that a bot, a page, or a late event obtains a session the owner
did not intend to give.

- **The cancel and dismiss races** (TASK-137) are the highest risk in the stack: a profile saved after the
  owner said no is an access bug, not a UI bug.
- **The tombstone and generation** (TASK-136) are what make sign-out mean something when two writers race.
- **Cross-profile egress** (TASK-127): the binding, not the frame's `profileId`, decides.
- **Prompt injection** asks a bot to request a site it has no business with; the card appears, and nothing
  is granted (TASK-43 AC9).
- **The save filters cookies** to the site and its approved auth hosts before encryption, and a failed
  compare-and-set leaves the old profile intact (TASK-34).

## Testing

- Decider tests for every transition in the table, including both race pairs: Cancel then completion, and a
  second client's Sign in while a flow runs.
- Expiry with `TestClock`: the asking clock resumes across a Cancel, turn end expires `asking` and never
  cuts a flow, and an abandoned flow returns the request to `asking`.
- Sign out, sign in, sign out again: the first flow's late save is refused, and a check in flight cannot
  re-create the profile.
- The card's states are exercised on fixtures in isolated web and desktop (see the build order), against
  the same six request states the server has, and the card's state is a pure function of the request record
  with a test over every state and the submitting and PC-routed variants, so the card cannot drift into a
  second state machine.
- A refused egress host raises one confirm per host per flow, and a profile outside the desktop's binding is
  refused before any DNS or TCP.
- Path guard on the ciphertext path, a corrupted envelope, and a generation-`g` file copied to `g+1`.

## Build order: screens first

Decision-53 applies with force here, because the sign-in stack has nine backend cards and none of them has
started: nothing about this flow should be built in the dark. The screens land on fixtures first, Mohammad
clicks through every state, and the server follows behind one seam.

### The gate

| Phase | What ships                                                          | Starts             |
| ----- | ------------------------------------------------------------------- | ------------------ |
| 0     | Every sign-in screen on fixtures, in dev, web, desktop and mobile   | now                |
| —     | **Mohammad clicks through the whole flow and says go**              | after phase 0      |
| 1     | The server: tables, decider, store, lease, form, save, tool, health | on his go          |
| 2     | Wiring, PC routing and the grant UI, automatic re-sign-in           | in the order below |

Phase 0 changes no `packages/contracts`, no `apps/server` code and no migration. The fixture states are
exactly the six request states above, so phase 1 replaces a data source, not a design.

### Phase 0: the screens

| #   | Card                   | Screen                                                                                                                                                                                          |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | TASK-130 (screen half) | The card in the chat, all states of the table above including Finishing sign-in and This request expired, plus the form (E3a/E3c), web and desktop                                              |
| S2  | TASK-131 (screen half) | Settings › Signed-in sites: rows with health badge and last check, empty state, row menu, auth hosts, Bots with access and Revoke, the sign-out confirm, the Allowed hosts sheet (desktop only) |
| S3  | TASK-132 (screen half) | Palette rows, the three outcome toasts, the Warning toast's Sign in again action, and the Toast action slot it needs                                                                            |
| S4  | TASK-130 PR 3          | The mobile native form sheet (E7d) on the same fixtures                                                                                                                                         |

TASK-136, 137 and 141 have no screen of their own: their user-visible half _is_ states in S1 (Finishing
sign-in, This request expired, "this site is signed out" on Check and Sign in again), and their server half
lands inside the cards below.

### One seam

Same rule as the skills registry and chat recall:

- The card, the page and the palette read `packages/client-runtime/src/browserAuth/siteSignIn.ts`, which
  exports the request and flow hooks plus **the three site operations once** — Check, Sign in again, Sign
  out — so the page, the palette and the inbox item call the same code.
- No screen calls `browser-auth.*` or the egress IPC itself.
- Fixtures follow [the skills registry's seam rule](skills-registry.md#the-one-seam): the machine and the
  fixture source read no platform global and take the flag as an argument (web and desktop pass
  `import.meta.env.DEV`, mobile passes `__DEV__` for S4's native sheet), and the card, the page and the palette
  render nothing when the seam returns `unavailable`. In a shipped build no card and no Signed-in sites page
  exists until phase 1, because there is no profile to show and a lying profile row is worse than no row.
- The Allowed hosts sheet is a desktop-process surface even on fixtures: it reads the granted hosts, never a
  host named by the server.

### Reaching every state on fixtures

The fixture source is not a gallery of cards. It implements the same seam the RPC will, so every state is
reached by a click or a declared input, and the card stays a derivation of the request record.

- **Drive the real machine.** The fixture source holds one request record per (thread, site) and implements
  start, join, cancel, dismiss, allow and the flow's advance. The card's buttons call those and the card
  re-derives. Nothing renders a state by hand, so a click that works on fixtures works after phase 1.
- **A dev-only state picker sets the record**, never a card: state, kind, `submitting`, failure class, saved
  password, PC routed. The card derives from the record. The picker is absent from a production bundle, not
  merely hidden, and appears only while the fixture source is active.
- **Seeded on the open chat**, so the card appears where a real one would: a fresh Asking for the current
  bot and thread, one open request per (thread, site), and a fresh Asking on another thread.
- **What only the picker can set**, because no single tab can click its way there: `in_progress` (the second
  client's join and Continue sign-in), `submitting` (Finishing sign-in, where Cancel is refused), `expired`,
  and each failure class (`in-use`, `signed-out-meanwhile`, `vault-disabled`). Waiting for your PC and
  password-saved are derived from PC-routed and saved-password, not separate states.
- **Reverse states stay clickable**: Cancel returns the request to Asking with the asking clock resumed, Not
  now leaves the dismissed card, and Allow turns an access request into a grant.
- **One clock the owner controls.** The 10-minute asking wait and the 5-minute abandonment cannot be clicked
  in real time, so the fixture source exposes "expire now", running the same expiry path the server will.

### After the go

1. **TASK-26, the tables.** Generation, tombstone, `auth_hosts`, the request columns with no `cancelled` and
   no `expires_at`. Nothing can be built correctly before this.
2. **TASK-27, contracts and the decider.** The state machine, compare-and-set start, first terminal wins,
   the caps, `startUrl` normalization, and TASK-137's rules.
3. **TASK-24 and TASK-25 in parallel.** The encrypted store and the lease.
4. **TASK-35 and TASK-36.** The login agent and `flow.watch` / `flow.submit`, including the abandoned-flow
   rules.
5. **TASK-34.** Detect signed in, filter cookies, save at `generation + 1`, record auth hosts.
6. **TASK-43 with TASK-141's hooks.** The tool, its 10-minute wait, and expiry on turn end, interrupt,
   thread delete and bot removal.
7. **TASK-50.** The health check, the badge and Check.
8. **Wire S1, then S3 and S2.** Sign out needs TASK-136's tombstone; Check needs TASK-50.
9. **TASK-42 and TASK-127's second PR.** PC routing, the Waiting for your PC state and the real Allowed
   hosts sheet.
10. **TASK-30**, then the push and lock-screen cards (133, 134, 135, 143).

`docs/user/` gains Signed-in sites and the sign-in card in step 8, when a user can see them. Phase 0 changes
no user documentation, because no user sees it.

## Open questions

- The push copy on the lock screen (TASK-134, decision-35) must agree with the card's site name and punycode
  rule. It is out of this stack but not out of this vocabulary.
- Whether the mobile sheet shows the auth-host approval at save time (D8 covers the form, not this step).
- The stale doc name: cards that say `docs/internals/browser-auth.md` should be corrected to this file as
  they are picked up.
