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
   * Deliberately NOT used for an entity that still exists in another state (an
   * archived thread, a bot already in the group) or for an id that is taken on
   * create: those tell the user "this is gone" about something that is right
   * there, and each has its own remedy.
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
   */
  "unknown-fleet-template",
  /**
   * Bot mentions arrived for a chat that is not a space chat. A composer's
   * addressing state can outlive the chat it was set in, so the client is not
   * necessarily stale; the remedy is to remove the mention and send again, which
   * no existing code names. It cannot share `thread-state-invalid` because the
   * chat's state is fine — the mention is simply misplaced.
   */
  "thread-does-not-take-mentions",
] as const;

export const CommandRefusal = Schema.Literals(CommandRefusalCodes);

export type CommandRefusal = typeof CommandRefusal.Type;
