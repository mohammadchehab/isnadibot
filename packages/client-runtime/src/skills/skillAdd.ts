import { skillConnectorName } from "./skillPresentation.ts";
import type { RegistrySkill, SkillAddRefusal } from "./types.ts";

/** What an archive may hold: 5 MB and 200 plain files, per the registry spec. */
export const SKILL_ADD_LIMITS = { maxBytes: 5 * 1024 * 1024, maxFiles: 200 } as const;

const ZIP_MAGIC = [0x50, 0x4b] as const;

const BYTES_PER_MB = 1024 * 1024;

/**
 * Whether the field holds a GitHub link. The dialog enables its primary on this alone: whether
 * the folder exists is the source's answer, not the field's.
 */
export function skillAddUrlIsGitHub(url: string): boolean {
  try {
    const parsed = new URL(url.trim());

    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "github.com" || parsed.hostname === "www.github.com")
    );
  } catch {
    return false;
  }
}

/** The folder a GitHub link names: the last path segment, without a query, hash or trailing slash. */
export function skillAddNameFromUrl(url: string): string | undefined {
  try {
    return new URL(url.trim()).pathname.split("/").findLast((segment) => segment !== "");
  } catch {
    return undefined;
  }
}

/** `7.4 MB`: what the too-big refusal names, so the user knows how far over the file is. */
export function skillAddFileSizeLabel(sizeBytes: number): string {
  return `${(sizeBytes / BYTES_PER_MB).toFixed(1)} MB`;
}

/**
 * The two archive refusals a client can reach before any upload: an archive over the limit, and
 * a file that is not a zip at all. Every other refusal is the source's.
 */
export function skillAddZipRefusal(input: {
  readonly sizeBytes?: number | undefined;
  readonly leadingBytes?: readonly number[] | undefined;
}): SkillAddRefusal | null {
  if (input.sizeBytes !== undefined && input.sizeBytes > SKILL_ADD_LIMITS.maxBytes) {
    return "zip-too-big";
  }

  const leading = input.leadingBytes;

  if (leading !== undefined && (leading[0] !== ZIP_MAGIC[0] || leading[1] !== ZIP_MAGIC[1])) {
    return "bad-archive";
  }

  return null;
}

/** One provider's skills, under the provider's own name. */
export type SkillProviderGroup = {
  readonly driver: string;
  readonly label: string;
  readonly skills: readonly RegistrySkill[];
};

/**
 * The provider skills the Add a skill dialog lists, grouped by the driver that reports them, in
 * the order the registry gives them.
 */
export function skillProviderGroups(
  skills: readonly RegistrySkill[],
): readonly SkillProviderGroup[] {
  const groups = new Map<string, RegistrySkill[]>();

  for (const skill of skills) {
    const driver = skill.providerDriver;

    if (skill.source !== "provider" || driver === undefined) continue;

    const group = groups.get(driver);

    if (group === undefined) groups.set(driver, [skill]);
    else group.push(skill);
  }

  return [...groups].map(([driver, grouped]) => ({
    driver,
    label: skillConnectorName(driver),
    skills: grouped,
  }));
}
