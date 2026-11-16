type Translate = (message: string, params?: Record<string, string | number>) => string;

type Plural = (
  count: number,
  forms: Readonly<{ one?: string; other: string }>,
  params?: Record<string, string | number>,
) => string;

export interface SpaceSettingsTranslator {
  readonly t: Translate;
  readonly plural: Plural;
}

export interface SpaceSettingsMember {
  readonly id: string;
  readonly name: string;
}

/**
 * Everything the Work card shows, decided once so the status line, the two
 * controls and their hints cannot disagree about the same space.
 */
export interface SpaceSettingsState {
  readonly memberCount: number;
  readonly bossName: string | null;
  /** The sentence under the page title: the space's one at-a-glance summary. */
  readonly statusLine: string;
  readonly bossDisabled: boolean;
  readonly bossPlaceholder: string;
  readonly bossHint: string | null;
  readonly keepBusyDisabled: boolean;
  readonly keepBusyHint: string | null;
}

function statusLineFor(
  memberCount: number,
  bossName: string | null,
  { t, plural }: SpaceSettingsTranslator,
): string {
  if (memberCount === 0) return t("No bots yet");

  const count = plural(memberCount, { one: "{count} bot", other: "{count} bots" }, undefined);

  return bossName === null
    ? t("{count} · No boss yet", { count })
    : t("{count} · {boss} is the boss", { count, boss: bossName });
}

/** Why the Boss row cannot be used yet, or nothing when it can. */
function bossHintFor(memberCount: number, bossName: string | null, t: Translate): string | null {
  if (memberCount === 0) return t("Add a bot to this space first.");

  if (memberCount === 1) return t("The only bot in this space.");

  if (bossName === null) return t("Cards wait in the queue until a boss is chosen.");

  return null;
}

/** Why keep-busy cannot be turned on yet, or nothing when it can. */
function keepBusyHintFor(
  memberCount: number,
  bossName: string | null,
  t: Translate,
): string | null {
  if (memberCount < 2) return t("Needs two bots — one to work, one to hand off to.");

  if (bossName === null) return t("Cards wait in the queue until a boss is chosen.");

  return null;
}

/**
 * A space with fewer than two bots, or no boss, has nothing to hand work to,
 * so keep-busy stays off and says which of the two is missing. The boss row
 * names the one control that can change it, and never a switch that cannot move.
 */
export function spaceSettingsState(
  input: {
    readonly members: ReadonlyArray<SpaceSettingsMember>;
    readonly bossBotId: string | null;
  },
  translator: SpaceSettingsTranslator,
): SpaceSettingsState {
  const { t } = translator;
  const memberCount = input.members.length;
  const bossName = input.members.find((member) => member.id === input.bossBotId)?.name ?? null;

  return {
    memberCount,
    bossName,
    statusLine: statusLineFor(memberCount, bossName, translator),
    bossDisabled: memberCount === 0,
    bossPlaceholder: memberCount === 0 ? t("No bots yet") : t("Choose a boss"),
    bossHint: bossHintFor(memberCount, bossName, t),
    keepBusyDisabled: memberCount < 2 || bossName === null,
    keepBusyHint: keepBusyHintFor(memberCount, bossName, t),
  };
}
