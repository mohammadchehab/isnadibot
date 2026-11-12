# Site sign-in security requirements

> For maintainers. What the sign-in stack must get right before a site password, a signed-in session or a host grant
> is within a bot's reach. The flow, its states and its build order are the architect's `docs/internals/site-signin.md`
> (TASK-183); this is the security half of it (TASK-184).
> Using IsnadiBot? See [docs/user](../user/).

A sign-in is where IsnadiBot takes a credential the user typed and turns it into standing access a bot can spend on
later turns. Everything below exists to keep three things true: the password reaches only the browser the server
holds, the session reaches only the bots the owner granted, and the hosts that session may reach are the ones the
owner typed on their own PC.

These requirements are the gate for TASK-130 (the card and the form), TASK-131 (Signed-in sites) and TASK-132 (palette
actions), and for the three hardening cards — TASK-136 (sign-out generation), TASK-137 (one flow per request),
TASK-141 (expiry) — whose code lands in TASK-27, TASK-36 and TASK-43. Each names the test that proves it.

## Threat model

Four ways in, each with a different attacker.

- **A bot that asks.** The card appears because a bot's turn called `browser_session_request`. The site name, the
  reason and the start URL on that card are text the model produced, and a prompt-injected bot controls all of it.
  Its goal is a card that looks like a sign-in to the site the owner expects, while the browser is pointed somewhere
  else — or a host grant for an origin the attacker chose. The same bot gets the outcome string when the flow ends.
- **A second client.** A member session in a shared group chat, a stranger's phone on a paired link, or the owner's
  own second tab. Pressing Sign in, joining a flow or watching a form are all acts on a password the owner is typing.
- **The environment server.** A remote environment the owner does not fully control names a `profileId` when it opens
  an egress stream, or starts a flow it was not asked to start. That is the TASK-118 finding, closed by TASK-127.
- **The machine.** Anything that can read a file, a log, a crash report, a checkpoint, a client store, a screenshot
  or a browser profile copy that outlived the session it belonged to.

What is _not_ an attacker: the user's own provider app. A provider runtime already runs as the user, in the user's
files.

## Where a password and a session stand

### The password

It has exactly two resting places and one moving one, and none of them is a client.

- **The vault** ([credential vault](./credential-vault.md)): `vault.json`, mode 0600, AES-256-GCM with the credential
  id as associated data, so a sealed value cannot be moved to another profile. The master key is never written to
  the home, and a locked, denied or unreachable keychain is an error — never a reason to generate a new key. With no
  key source the vault is `disabled` and `set` fails; the sign-in still works, it just cannot offer "sign in again
  from the saved password".
- **The server browser.** The login agent types the value into the page. The value is a field of one
  `browserAuth.flow.submit` payload and is dropped when the step ends.
- **The client contract.** Answers travel from the form to `flow.submit` and nowhere else. They are not a command,
  never enter the event store, and are not held in an atom, a store or a snapshot — the password field is
  component-local and is cleared on submit and on unmount.

Requirements:

- A password, a one-time code or any field the form does not specifically recognise is **never** in an orchestration
  event, a thread activity, a chat message, a checkpoint, an audit record, a usage record, a log line or a crash
  report. The bot's tool result is the outcome string and the handle name, never the value.
- A one-time code is not saved. Only the credential the user agreed to keep goes to the vault, and it does so through
  the vault's write path, never a file the sign-in code writes itself.
- Sign-out deletes the profile's vault credential (TASK-136 AC1, AC8). A re-sign-in after sign-out therefore finds no
  saved password, which is the observable proof.
- The vault is opened once per server start, after the home lock, so a second server cannot race key generation. The
  sign-in code reads it through the broker-only `SecretReader`; the write-only `SecretVault` is the only thing that
  stores.
- The master-key environment variables are stripped from `process.env` at startup and `withoutMasterKeyEnv` is used
  for every child environment, so a provider or git subprocess started during a turn cannot read them.

### The session

The session is the browser profile: ciphertext in the ProfileStore, one writer at a time, and a generation.

- **One writer.** TASK-25's lease is what stops a health check and a login agent from writing the same profile at
  once. A lease is not authorization: an expired lease holder that takes a new one is a valid writer. That is why the
  generation exists.
- **The generation is the authorization for a write.** Every save (TASK-34) and every health write (TASK-50) carries
  the generation it started from, and a write whose generation is not current is refused as `stale-generation`. A
  refused save ends the flow as "signed out meanwhile"; it does not resurrect the profile.
- **Sign-out is a tombstone, not a delete.** `browser-profile.sign-out` is a decider command that bumps the
  generation to `g+1`, nulls the ciphertext and marks the row signed out, serialized per profile by the event store.
  It never waits for the lease; whatever holds the lease is refused on its next write. A fresh sign-in reads `g` and
  saves at `g+1` with a compare-and-set on `g`.
- **A tombstone expires out of the shell after 24 hours** but is never readable as a live profile, and Check or
  Sign in again on one is a no-op that says the site is signed out — no "unknown profile" error reaches a user.
- **A live signed-in context dies at sign-out.** Each click or type through `forHandle` checks the current
  generation, so the bot's next action on that site fails with a typed refusal rather than riding a revoked session.
- **The bot holds a handle, not a session.** TASK-43 issues a per-(bot, thread, profile) handle with a grant. It can
  be revoked from Signed-in sites, revoking ends that bot's live handles, and `lastUsedAt` is deliberately kept out
  of the shell so a per-turn touch does not republish it.

## What the card may display

The card is the one surface where attacker-controlled text and a password field are on screen together, so it has a
fixed shape.

| The card shows                                                 | Because                                                   |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| The site name, first and prominent, with the mixed-script flag | a homograph has to be visible before the form opens       |
| The start origin under the site when the request has one       | the site the bot named and the page it opens differ often |
| The requesting bot's name, from its record                     | the bot's own text never supplies a name (finding 24)     |
| The bot's reason, as plain text, capped, never linkified       | a link in a reason is a second, unvalidated destination   |
| The form's **current** origin above the fields                 | an SSO hop must be visible, not silent (AR-3)             |
| One settled line: signed in, failed, declined, expired         | the outcome is a fact, not a prompt                       |

| The card never shows                                      | Because                                           |
| --------------------------------------------------------- | ------------------------------------------------- |
| A password, a one-time code, or any prefilled field value | it would be in the DOM, the snapshot and the chat |
| A cookie, a token, a handle name, a session identifier    | none of it is useful to the user                  |
| Another profile's site, hosts or bots                     | the card is per request                           |
| A host list, or a live count of allowed hosts             | grants live on the PC and are listed there        |
| Anything the bot asked to be rendered as markup           | the reason and the site are data                  |

Two more rules that are about the _record_ rather than the frame:

- **The card's state is derived, never stored in the UI.** `deriveSignInCard(request, settledActivity, clientId)` in
  `packages/client-runtime` computes every state from server data, so a second client, a reload or a reconnect shows
  the same thing. A card whose state lives only in the UI is how a stale Asking card starts a sign-in nobody waits
  for (TASK-141).
- **A push and a lock screen carry no site name** (decision-35). The inbox row may name the site to a signed-in owner;
  the lock screen shows generic text until an on-device decryption path ships.

## Allowed hosts is the permission boundary

A signed-in profile's network permission is a **list of hosts owned by the desktop**, checked on the PC, per profile,
default deny ([egress transport](./egress.md)). Nothing else decides reachability: not the site, not the bot, not the
server's `profileId`, not the sign-in flow.

Requirements, each of which is a TASK-127 acceptance test:

- **Default deny.** An empty store, a missing store and a store that fails to decode all refuse every `open`. An
  unreadable file is never rewritten implicitly; only Reset replaces it, and Reset is the way out of that state.
- **The profile is bound to an environment by the user, not by the frame.** The desktop keeps its own binding from a
  backend instance id to the profile ids that backend may serve. A `profileId` outside the binding is refused with
  `host-not-granted` before any DNS or any TCP.
- **Exact or suffix, normalized, on a label boundary.** `example.com` covers itself and every subdomain and nothing
  that merely ends in the string. A suffix grant on a public suffix, a single label or an IP-shaped value is refused
  when saved. Wildcards are typed by the owner and are never inferred from a `*.` a bot or the server supplied.
- **A grant is not an address allowlist.** A granted name that resolves to a private, loopback, link-local, metadata
  or interface-subnet address is still blocked, because the dialer classifies every resolved address.
- **Sign-in never widens a grant.** The auth hosts a site turns out to use (TASK-34's `authHosts`) are display only.
  An SSO hop to an ungranted host fails closed and, at most, raises one native confirm for that exact host, once per
  host per flow, with the owner's click as the only way to grant it. Cancel leaves it refused and the flow does not
  ask again.
- **Revoke takes effect at once.** Revoking a grant, changing a binding or resetting publishes a revocation; live
  streams of that profile are re-evaluated and the ones no longer allowed end, including a dial still in flight.
- **Every grant is written by main, after a native confirmation main builds.** The confirm's largest text is the
  validated host and its kind; a label the app supplied is secondary, captioned as such, plain text and capped. One
  confirm per grant, no batch, no silent grant, and nothing the renderer, the server or a bot sends can grant.
- **Every grant and revoke is logged locally** (profile id, host, port, action, time — never a token), written before
  an add takes effect, and a failed log write blocks an add and never a remove.
- **Revoke is available where the grants are.** Desktop only in v1 (decision-38): Settings → Signed-in sites → Allowed
  hosts, plus the egress-provider session's Revoke in Settings → Connections. A phone can neither grant nor revoke.

## Who may act

Scopes say what a credential _can_ do; the principal says who is holding it. Both apply to everything here.

- `browserAuth.flow.watch` and `browserAuth.flow.submit` are the only flow RPCs, at `orchestration:operate`.
  Starting, cancelling and dismissing a sign-in are orchestration commands (`browser-auth.request.start` /
  `.start-owner` / `.cancel` / `.dismiss` / `.allow`), not RPCs, so a start is one audited state change. Both
  surfaces are **owner-only for a member principal**. A member session sees the card in In progress with no Sign in
  and no Continue. The rule is enforced in the same exhaustive table as scopes (`RPC_MEMBER_ACCESS`, one entry per
  RPC, new RPCs owner-only until someone classifies them), so a new flow RPC cannot quietly default open, and the
  commands are owner-only in the decider's principal check.
- **Owner is the session principal, not `access:write`.** The owner's phone pairs with standard scopes; keying this
  on `access:write` would take Continue away from the one place people actually sign in.
- `browser-auth.request.start-owner` exists for Settings, the palette and the inbox. It creates a request with no bot
  and no thread, and Cancel on it is terminal — no bot is waiting, so there is nothing to return to.
- `browser-auth.request.allow` is the only client path to a grant: the owner allows an `access` request, and the
  decider turns it into one grant for that (profile, bot, thread). `grant.create` stays internal, so no client can
  mint a grant for a pair it was not shown. `browser-auth.grant.revoke` is a client command for the owner. The
  decider refuses a bot principal revoking a grant it does not hold.
- Sign-out, check and the three site actions are dispatched by a client through one shared module
  (`packages/client-runtime/src/browserAuth/siteActions.ts`), so the page, the palette and the inbox cannot drift into
  three different orderings of the same decision.
- **No bot path reaches any of this.** No tool, routine, delegation or skill can start a request, approve one, join a
  flow, grant a host, revoke a grant or sign a site out. The bot's entire surface is `browser_session_request` and the
  outcome string it returns.

## Re-check, expiry and sign-out guarantees

These are the properties a user is entitled to assume, with the numbers.

- **A sign-in nobody is waiting for cannot start.** An Asking request expires after 10 minutes of _asking_ time and on
  turn end, interrupt, thread delete, and bot archive or delete. The clock pauses while a flow is open and resumes —
  it does not restart — so repeated Cancels cannot extend a bot's wait. A start on an expired request is refused
  server-side, and the bot is told "owner did not answer".
- **Only one flow per request.** `browser-auth.request.start` is a compare-and-set on `asking`. A second client's Sign in joins the
  existing flow. The card shows Continue sign-in, not a second Sign in.
- **The first terminal event wins.** Cancel is refused while `submitting` (the card says "Finishing sign-in…"), so a
  hung submit cannot be cancelled out from under a finished step; `submitting` clears on the submit's result or at the
  step timeout. A completion that arrives after Cancel or Not now is dropped: no profile is saved, and the bot is not
  told it signed in.
- **Not now is the only decline.** It is terminal and tells the bot the owner declined. Cancel is not a decline: a bot
  request returns to asking with the clock still running, and an owner-started request is dismissed.
- **An in-progress flow is never cut.** It finishes, saves and posts a settled line so the bot's next turn can use the
  site. Its only timeout is abandonment: 5 minutes with no client attached in `awaiting-input` or `human`, 10 minutes
  in `external-action` (an MFA push), after which the request returns to asking, or expires if its turn has ended.
- **Sign-out always wins.** It is not blocked by a flow, a check, an open inbox item or a failed audit write. The
  profile generation bump and the open inbox item for that profile are resolved in the same decider step, so a banner
  asking about a session that no longer exists cannot survive it. The vault credential is deleted, the handles are
  revoked, the live contexts die, and the store copy goes — a reactor does the side effects idempotently and emits a
  settled receipt the test waits on. A sign-out that fails partway re-runs the steps the receipt does not show done.
- **A check never resurrects a profile.** A check on a signed-out profile is a no-op that says so, and a check holding
  the lease when the sign-out lands is refused on its write.

## Failure modes, fail closed

| Failure                                                  | Behaviour                                                                                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| The vault has no master key, or the key is wrong         | the vault is `disabled` with a reason logged (never key material); sign-in still works, "sign in again from a saved password" does not |
| The keychain is locked, denied or unreachable            | an error; never a reason to generate a new key                                                                                         |
| A flow's save finds a newer generation                   | refused as `stale-generation`; the flow ends "signed out meanwhile"                                                                    |
| The grants file is unreadable                            | deny every host; the Allowed hosts page shows Reset and nothing is rewritten                                                           |
| A host is not granted, or resolves to a blocked range    | refused before any TCP                                                                                                                 |
| An RPC's member classification is missing                | owner-only, because the table is exhaustive and does not compile otherwise                                                             |
| The principal read fails or the scope cannot be computed | an empty member scope — never owner                                                                                                    |
| An audit write fails on sign-out or revoke               | logged and retried; the access cut proceeds                                                                                            |
| A card arrives with a request that no longer exists      | no card; the settled line, or nothing                                                                                                  |

## Review checklists

TASK-130 PR 1 — the card, the form and the integration tests:

- [ ] A sentinel password is in no store snapshot, no event, no thread activity, no log and no checkpoint after
      submit; the same grep covers a one-time code.
- [ ] Two clients press Sign in at once and there is one flow, both cards in In progress.
- [ ] Cancel then a late completion saves no profile, returns the request to Asking and does not resume the bot.
- [ ] A turn end while asking expires the request and the tool returns "owner did not answer"; a turn end while
      in-progress lets the flow finish, save and post the settled line.
- [ ] A sign-out during a flow is refused at save and the card says the flow ended.
- [ ] The form's current origin is shown above the fields and changes visibly on an SSO hop.
- [ ] The reason renders as plain text (a `<script>` and a URL in it are inert), and the bot name comes from the
      record.
- [ ] `deriveSignInCard` is a table test over every request state, and no state is reachable only in the UI.
- [ ] A member session is refused `flow.watch` and `browser-auth.request.start`; the owner's standard-scope phone
      session can join.

TASK-131 — Signed-in sites:

- [ ] The sign-out confirm's copy says it removes the saved session from IsnadiBot and does not sign you out of the
      site.
- [ ] Sign out writes the tombstone at `g+1`, deletes the vault credential, revokes the handles and resolves the open
      inbox item, in one decider step plus one idempotent reactor whose receipt the test waits on.
- [ ] Check and Sign in again on a tombstoned profile do nothing and say so.
- [ ] Row detail lists the profile's auth hosts and the bots holding a grant, with one Revoke per bot; Revoke is
      owner-only and the decider refuses a bot-principal cross-bot revoke.
- [ ] `profile.signed-out` and `grant.revoked` are written through the audit service and neither can block the cut.
- [ ] An unloaded list never renders as the empty state.
- [ ] The Allowed hosts sheet is desktop-only, refuses a typed `*.` as an exact grant, and calls prune when the
      profile list changes.

TASK-132 — palette actions:

- [ ] Every row's `run` is one of the three shared operations; the palette adds no behaviour of its own.
- [ ] A profile tombstoned while the palette is open produces "This site is signed out" and never an unknown-profile
      error.
- [ ] The three actions are owner entry points and are hidden in member mode.

TASK-136, TASK-137, TASK-141 — the hardening, proved where the code lands:

- [ ] Decider table tests cover state × command, including Cancel while submitting, a completion after dismissed, and
      a completion whose flowId no longer matches.
- [ ] Sign out, sign in, sign out: the first flow's late save is refused.
- [ ] A health check in flight during sign-out cannot re-create the profile.
- [ ] TestClock: the asking limit passes, the tool returns, the card is expired, a start is refused; the turn ends
      while asking and the suspended tool resolves.
- [ ] A hung submit reaches the step timeout, `submitting` clears, Cancel succeeds, and the late completion saves
      nothing.

TASK-127 PR 2 — Allowed hosts (the grants store itself is TASK-118's checklist):

- [ ] Grants and bindings are written only by main, after a native confirmation main builds, with Cancel as default.
- [ ] A confirm writes the grant; a cancel writes nothing; an invalid host is refused before any dialog.
- [ ] Revoke has no dialog and ends live streams; reset confirms and is the only way out of `unreadable`.
- [ ] An SSO refusal raises one native confirm per host per flow, and a second refusal in the same flow does not
      re-prompt.
- [ ] The grant log line is written before an add takes effect, and a failed log write blocks the add and never a
      remove.
- [ ] Web and mobile have no Allowed hosts surface and no egress-provider Revoke.

## Accepted risk

- **The PC is trusted.** A process running as the same uid can read the vault key from `/proc/<pid>/environ` while the
  server runs with the environment source, and can read `vault.json` and the ProfileStore. The vault protects the data
  at rest and in transit to the wrong home; it does not defend the machine against its own user's processes.
- **A stored password is a standing secret.** The owner chose to keep site passwords (decision-6), so a compromise of
  the home is worth more than a session: it can re-sign in later, not just ride an existing cookie. Sign-out, the
  per-bot Revoke and deleting the vault entry are the way back out.
- **A prompt-injected bot still gets a card.** The card can be wrong about why, and — within the copy rules — what it
  says. What it cannot do is pick the host the browser reaches (grants) or receive the password (the form).
- **The live view shows the real page.** When the live-view fallback ships, the owner may see a password field, a
  masked value or a session token in a URL. The form is the preferred path for exactly this reason; the redaction
  that applies to provider-visible screenshots is not automatically the right redaction for the owner's own eyes.
- **A grant is per host, not per page.** A permitted host that serves many tenants or untrusted user content is
  reachable in full. Allowed hosts is a tool for choosing hosts carefully, not a path-level policy.

## Open questions

- **Screenshot and live-view redaction during sign-in** is TASK-32's to answer: what, if anything, the live view
  must mask, and whether the same `redactComputerScreenshot` boundary applies to a page the owner opened themselves.
  Not assumed by any checklist above.
- **Pasting a password into the form** is neither blocked nor discouraged today. Blocking paste breaks password
  managers, which is worse than the risk; the alternative is a clipboard-owner notice. Product call, not a
  requirement here.
- **How many host prompts one sign-in may raise.** A redirect chain can recruit several auth hosts. One prompt per
  host per flow is bounded, but the copy for the second and third prompt is undesigned.
