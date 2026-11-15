import * as Schema from "effect/Schema";

/**
 * Why the server refused a command, when the client has a dedicated path for
 * it. The code is attached at the throw site, so a refusal's reason never has
 * to be recovered from the prose in `message`.
 *
 * The wire field that carries this (`OrchestrationDispatchCommandError.refusal`)
 * is deliberately a permissive string: the client decodes the whole exit, so a
 * code it does not know must degrade to `message` rather than fail the decode.
 * This set is what a current client can switch on.
 */
export const CommandRefusalCodes = [
  "open-work-items",
  "environment-rights",
  "bot-is-group-boss",
  "group-would-be-undersized",
  "delegation-limit-reached",
  "delegation-would-cycle",
  /**
   * Authorization, not a business rule: the actor is neither a member of the
   * group nor allowed to manage groups, so no change to the group would let the
   * command through. Its remedy is access, not a different edit, which is why it
   * stays a literal of its own instead of folding into the boss or undersized
   * refusals above.
   */
  "actor-not-a-group-member",
  /**
   * The command type is wrong for the actor's own account, not the actor's
   * rights: `group.leave` acts on the caller, so naming anyone else is refused
   * however much access they hold. It cannot share `environment-rights` above —
   * telling someone with manage rights that they lack rights sends them to ask
   * for something they already have. The remedy is a different command,
   * `group.person.unassign`, which the sentence names.
   */
  "leave-only-as-yourself",
  /**
   * A stale click, not a permissions problem: the bot the client offered is no
   * longer in the group, so the roster it drew came from a view the server has
   * already left behind. Its remedy is a refresh, which is why it cannot share
   * `actor-not-a-group-member` above — that one is about the person, this one
   * about the bot they picked.
   */
  "bot-not-a-group-member",
  /**
   * A business rule about the command, not about the actor and not about a
   * stale roster: the bot is real and its home is real, but a create may not
   * silently move it out of that home. It cannot share
   * `bot-not-a-group-member` above, whose remedy is a refresh — here the user
   * has to create the space without the bot and add it afterwards, which
   * `group.member.assign` performs as a deliberate move.
   */
  "bot-in-another-group",
  /**
   * A create arrived with no boss at all. `group-already-has-boss` below is the
   * opposite situation and would tell the user something false about a space
   * that has none, so this keeps its own literal; the remedy is the boss the
   * command never named.
   */
  "group-requires-boss",
  /**
   * The bot being assigned is not the boss; another bot is. `bot-is-group-boss`
   * would tell the user something false about the bot they picked, so the two
   * stay separate even though both end in the same remedy.
   */
  "group-already-has-boss",
  /**
   * `group.boss.set` named the current boss and asked to unassign the previous
   * one in the same breath, so the command contradicts itself. It is not
   * `group-already-has-boss` above — that one fires when the bot picked is not
   * the boss — and the remedy is to drop the unassign or pick a different bot.
   */
  "boss-cannot-be-replaced-and-removed",
  /**
   * A turn was sent to a space and no bot in it can answer: the space has no
   * boss, or the boss is not an active member. One code for both sites, because
   * they are one fact and one remedy — the roster has nobody to answer, and the
   * fix is to set a boss or add a bot.
   *
   * It cannot share `bot-is-group-boss` (that one tells the user the bot they
   * picked leads the space) or `group-would-be-undersized` (whose sentence
   * sends them to add a bot *before removing one*, and which would be false
   * here — the space may hold three bots and still have no active boss). It is
   * not `thread-is-busy` either: the chat is fine, the roster is not.
   */
  "group-has-no-responder",
  /**
   * The chat has live work — a running session, a turn the user just sent that
   * no turn has adopted yet, or an approval/user-input request blocking the
   * agent — so settling or snoozing it would hide work the user is waiting on.
   *
   * One code, not three: the reason is the same (there is live work) and so is
   * the remedy (wait for it, or answer it). The three states differ only in what
   * the user does next, which the surface's own title already says.
   */
  "thread-is-busy",
  /**
   * The action does not fit the chat's current state: the pin order is stale
   * because the chat was unpinned elsewhere, there is no interrupted request to
   * resume, the turn is already running, the history is already restored, the
   * chat is not a group chat, or the snooze wake time has already passed.
   *
   * One code because every member shares a remedy: the client's picture of the
   * chat disagrees with the server's, and refreshing shows the real one. It
   * stays separate from `thread-is-busy` because waiting is the wrong advice
   * here — nothing is in flight to wait for.
   */
  "thread-state-invalid",
  /**
   * Channel delivery does not apply: the message being marked is not a bot
   * reply, or the chat is a delegated child that runs under its parent's turn
   * and so has no turn for an inbound channel message to land in.
   *
   * Separate from the two above because there is nothing for the user to do —
   * the surface offered an action that cannot apply to this message or chat.
   */
  "channel-delivery-unavailable",
  /**
   * The entity a command named is gone: a project, bot, group, thread, MCP
   * server or delegation another device deleted, so the client acted on a view
   * the server has already left behind. Its remedy is a refresh, which is why
   * every one of those lookups shares this literal rather than carrying its own
   * — the user's next move is the same whichever entity went missing.
   *
   * Deliberately NOT used where the entity's new state is itself the user's next
   * action — an archived thread they must unarchive, a bot already in the group,
   * an id taken on create — because each of those has a specific remedy of its
   * own. The test is reachability, not existence: a deleted routine is not still
   * there for the user even though the record is, because both clients filter it
   * out and nothing restores it, so a refresh is the whole remedy and this
   * literal fits. It IS used where the entity moved and the only thing the user
   * can do is look again: a card already closed when they went to close it.
   */
  "stale-view",
  /**
   * A create arrived for an id the environment already holds. The entity is
   * there and fine; the client created against a view that predates it. Its
   * remedy is the same refresh `stale-view` asks for, but the sentence differs:
   * telling the user "it has already been removed" about something that exists
   * would be false, so the two keep separate literals.
   */
  "already-exists",
  /**
   * The entity exists but sits in the state the command cannot act on: a bot
   * archived when a turn needs it live, or a thread already archived. One
   * remedy — unarchive — covers all three sites, which is why they share this
   * literal instead of borrowing `stale-view`: a refresh would change nothing.
   */
  "entity-archived",
  /**
   * A project cannot take a workspace root another project already owns. The
   * folder is in use, not missing, so neither `stale-view` nor `already-exists`
   * describes it, and the remedy — pick a different folder — is its own.
   */
  "workspace-root-in-use",
  /**
   * Client-server version skew, the only family whose remedy is to update
   * rather than to refresh: the id names a fleet template this build does not
   * ship, so nothing was deleted and no refresh can produce it. Advising a
   * refresh here would be false in the same way it would be on a not-archived
   * site.
   *
   * The family has two members — this literal and `unknown-fleet-role` below —
   * and they share the one remedy. What splits them is the noun the sentence
   * puts in front of the user: a template or a role. Keep them apart. Reusing
   * this one for a role names the wrong thing, and widening it to "template or
   * role" puts a schema word in user copy, so neither costs less than the
   * second literal does.
   */
  "unknown-fleet-template",
  /**
   * The role half of the version-skew family above: a hire named a boss role
   * its own copy of the template has and this build's copy does not. Same
   * remedy as `unknown-fleet-template` — update, not refresh — and a separate
   * literal only so the sentence can name a role instead of a template.
   */
  "unknown-fleet-role",
  /**
   * A hire's role has no engine the environment can run. The client resolves
   * engines with `fleet.plan` and sends them back as picks, so a role without
   * one is a choice the user still has to make — pick another provider — not a
   * stale view. The server's own detail names the role's id, which is why the
   * code has to reach the client.
   */
  "fleet-role-has-no-provider",
  /**
   * A hire left a role's name empty. The remedy is to type one, which no other
   * code names. It cannot share `fleet-roles-share-name` below: nothing is
   * duplicated here, the name is simply missing.
   */
  "fleet-role-needs-name",
  /**
   * Two roles in one hire would share a name, and a space's chat addresses bots
   * by name. The remedy is to rename one of the two, which is neither the
   * missing name above nor a refresh.
   */
  "fleet-roles-share-name",
  /**
   * Bot mentions arrived for a chat that is not a space chat. A composer's
   * addressing state can outlive the chat it was set in, so the client is not
   * necessarily stale; the remedy is to remove the mention and send again, which
   * no existing code names. It cannot share `thread-state-invalid` because the
   * chat's state is fine — the mention is simply misplaced.
   */
  "thread-does-not-take-mentions",
  /**
   * Not a refusal, and named here on purpose: the server ended a turn because the provider stopped
   * answering and the turn outlived the provider's liveness window. It carries the same job a
   * refusal code does — the surface renders the sentence from the one shared map instead of
   * printing the server's prose — so it joins this vocabulary rather than growing a second one that
   * would have to be kept in step.
   *
   * Distinct from the session-gone case: there the provider died with its session, here the session
   * is alive and the provider simply stopped. Same remedy (try again), different diagnosis.
   */
  "turn-went-silent",
  /**
   * A bot has already made as many bots as it may, counting every bot made under
   * the same creator chain. The refusal is a ceiling on multiplicity, not on
   * rights: the caller may be a boss with full access to its space, so advising
   * it to ask for access would be false. Its remedy is the user — a person
   * creating the bot is not counted against the bot's allowance.
   */
  "bot-creation-limit-reached",
  /**
   * The creator chain is already as deep as it may be: this bot was itself made
   * by a bot that was made by a bot. Separate from `bot-creation-limit-reached`
   * above because the remedy differs — breadth is relieved by a person creating
   * the bot, depth only by creating it nearer the top of the chain.
   */
  "bot-creation-chain-too-deep",
  /**
   * A command carried a bot origin and an acting person at once, which no client
   * can legitimately produce: the dispatch layer forces a client's origin to
   * null, so only a server-internal dispatch may name a creator bot. It is not a
   * business rule the user can satisfy differently — the command was malformed —
   * and it exists so a client cannot claim or launder a bot origin.
   */
  "bot-origin-forbidden",
  /**
   * A work-item command the card's own state does not allow: moving a finished
   * card, blocking one that is already done, unblocking one that is not blocked,
   * reopening one that is still open. Six sites in `workItems.ts`, one code.
   *
   * Separate from `thread-state-invalid` above for the reason that code exists:
   * the sentence names the thing in front of the user, and a card is not a chat,
   * so borrowing it would print a false noun at six sites. It also carries no
   * refresh clause, unlike its chat sibling: at most of these sites the client's
   * view is current and the move is illegal, so a refresh would change nothing —
   * the same written test `entity-archived` uses.
   */
  "work-item-state-invalid",
  /**
   * A space already holds as many open cards as it may. The cards are fine and
   * the client's view is current; the user has to finish or close one first.
   *
   * Not `open-work-items`, which is the delete-confirmation prompt and says the
   * group holds work that a delete would discard — nothing is being deleted
   * here. Not `stale-view` either, because a refresh changes nothing.
   */
  "work-item-limit-reached",
  /**
   * The server is installing an update and will not admit a new turn, so the
   * start is refused before anything is committed. Separate from
   * `thread-is-busy`: nothing is in flight in this chat, and waiting on the
   * chat would not help — the wait is on the server and ends on its own.
   *
   * Both admission sites raise it: the engine's dispatch gate, and the
   * bootstrap turn start that admits before it creates a thread or worktree.
   */
  "server-is-updating",
  /**
   * A routine command named a procedure version the routine has already moved
   * past: a draft save sent against the version the screen was showing, or an
   * approval of it. Two sites, one fact and one remedy — another device changed
   * the routine, so refresh and repeat the action against what is there now.
   *
   * Not `stale-view`, whose sentence is about an entity that is gone: the
   * routine is present and healthy, and the refresh is the prelude rather than
   * the whole fix. Not `thread-state-invalid` either, for the reason
   * `work-item-state-invalid` exists — a routine is not a chat, and borrowing
   * that literal would print a false noun.
   */
  "routine-version-conflict",
  /**
   * A routine's current procedure carries no approval, so nothing may be enabled
   * or run from it: the procedure was edited after it was approved, or never
   * approved at all. Both sites that reach it — enable and a non-dry run — share
   * the one remedy, which is to approve the procedure.
   *
   * Not `entity-archived`, whose remedy is to restore: nothing is archived here.
   * Not `routine-version-conflict` above, which is about a stale client and
   * asks for a refresh; a refresh changes nothing here, because the approval is
   * genuinely absent on the server.
   */
  "routine-procedure-unapproved",
] as const;

/**
 * The code attached to a turn the server ended because its provider went quiet: the session is
 * still alive, so nothing else will ever end it. Distinct from the session-gone case.
 */
export const TURN_WENT_SILENT_REFUSAL: CommandRefusal = "turn-went-silent";

export const CommandRefusal = Schema.Literals(CommandRefusalCodes);

export type CommandRefusal = typeof CommandRefusal.Type;
