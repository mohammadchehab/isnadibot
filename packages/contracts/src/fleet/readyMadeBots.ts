import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";
import { BotAvatar } from "../orchestration/roster.ts";
import { RoutineSchedule } from "../routines.ts";

export const ReadyMadeBotId = TrimmedNonEmptyString.pipe(Schema.brand("ReadyMadeBotId"));

export type ReadyMadeBotId = typeof ReadyMadeBotId.Type;

/**
 * A bot the roster can add in one step: the bot, its first chat, and a routine
 * draft whose job and procedure are already written. The procedure names the
 * target, so `readyMadeProcedure` finishes it at create time from what the user
 * typed.
 */
export const ReadyMadeBot = Schema.Struct({
  id: ReadyMadeBotId,
  avatar: BotAvatar,
  /** The routine's starting schedule; the form shows it in the viewer's timezone. */
  schedule: RoutineSchedule,
  /** The routine's name, which is also the chat's job title. */
  job: TrimmedNonEmptyString,
  /** Where the preset looks: a repo path or an http(s) URL. */
  defaultTarget: TrimmedNonEmptyString,
  /** Everything the procedure says except the target and the budget. */
  procedure: TrimmedNonEmptyString,
});

export type ReadyMadeBot = typeof ReadyMadeBot.Type;

/** What one unattended run may walk before it stops, so it cannot spin. */
export const LINK_MONITOR_LINK_BUDGET = 300;

export const LINK_MONITOR_BOT_ID: ReadyMadeBotId = ReadyMadeBotId.make("link-monitor");

/**
 * A run that checks no links has not passed: the docs were never reached. Every
 * wording below keeps that apart from a clean run, which is a run that checked
 * links and found none broken.
 */
const LINK_MONITOR_PROCEDURE = [
  "Walk every page at the docs location below and check each link on it.",
  "Within one repository, a link to a file or heading resolves inside that repository; an http or https link is checked over the network.",
  "A link is broken when its file, heading or URL cannot be reached. Write each broken link on its own line as `source page → target (reason)`, for example `docs/user/bots.md → ./setup.md (missing-file)`.",
  "A run that checks no links is a failed run: say the monitor found no docs to check at that location. Never report that no broken links were found unless the run checked at least one link.",
  "Stop at the link budget below and say in the report that you stopped early.",
  "Finish by replying in this chat with one line naming how many links were checked and how many were broken, then the broken ones. When the run fails, say which step failed: never a silent or empty report.",
].join("\n\n");

export const READY_MADE_BOTS: ReadonlyArray<ReadyMadeBot> = [
  {
    id: LINK_MONITOR_BOT_ID,
    avatar: { kind: "blob", shape: "hex", color: "#1FBFAE" },
    schedule: { kind: "daily", time: "09:00" },
    job: "Check docs for broken links",
    defaultTarget: "docs",
    procedure: LINK_MONITOR_PROCEDURE,
  },
];

export const readyMadeBot = (id: string): ReadyMadeBot | undefined =>
  READY_MADE_BOTS.find((candidate) => candidate.id === id);
