import type { ProjectId } from "@isnadi/contracts";
import {
  filterRegistrySkills,
  SKILL_REGISTRY_FILTERS,
  skillAttention,
  skillWinnersByName,
  useSkillRegistry,
  type RegistrySkill,
  type SkillRegistryFilter,
} from "@isnadi/client-runtime/skills";
import { PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { useRosterStore } from "../roster/rosterStore";
import { useRelativeTimeTick } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Skeleton } from "../ui/skeleton";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "../ui/table";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { SkillRegistryRow } from "./SkillRegistryRow";

const FILTER_LABELS = {
  "this-space": "This space",
  all: "All skills",
  unused: "Unused",
} as const;

function isSkillRegistryFilter(value: string | undefined): value is SkillRegistryFilter {
  return SKILL_REGISTRY_FILTERS.some((candidate) => candidate === value);
}

function SkillRegistryColumns() {
  const { t } = useI18n();

  return (
    <TableHeader>
      <TableRow presentation="flush">
        <TableHead presentation="muted" className="h-10 px-3 text-xs font-medium">
          {t("Skill")}
        </TableHead>
        <TableHead presentation="muted" className="h-10 w-30 px-3 text-xs font-medium">
          {t("Used by")}
        </TableHead>
        <TableHead presentation="muted" className="h-10 w-24 px-3 text-xs font-medium">
          {t("Source")}
        </TableHead>
        <TableHead presentation="muted" className="h-10 w-18 px-3 text-xs font-medium">
          {t("Size")}
        </TableHead>
        <TableHead presentation="muted" className="h-10 w-24 px-3 text-xs font-medium">
          {t("Last loaded")}
        </TableHead>
        <TableHead className="h-10 w-10 px-1">
          <span className="sr-only">{t("Actions")}</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

function SkillRegistrySkeleton() {
  return (
    <div className="flex flex-col gap-2 px-3 py-2" aria-hidden>
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="size-4 rounded" />
          <Skeleton className="h-4 w-40 rounded" />
          <Skeleton className="ms-auto h-4 w-24 rounded" />
          <Skeleton className="h-4 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}

/**
 * The skill registry: one list for a space's Skills tab and for Settings › Skills. Every value
 * comes from the seam, so phase 1 swaps the source and this screen does not change.
 *
 * A platform with no registry source reads `unavailable`, and this renders nothing; the space
 * tab and the Settings row that own it are hidden for the same reason.
 */
export function SkillRegistryPage({
  projectId,
  defaultFilter = "this-space",
  className,
}: {
  readonly projectId?: ProjectId | undefined;
  readonly defaultFilter?: SkillRegistryFilter | undefined;
  readonly className?: string;
}) {
  const { t } = useI18n();
  const registry = useSkillRegistry();
  const bots = useRosterStore((state) => state.bots);
  const [filter, setFilter] = useState<SkillRegistryFilter>(defaultFilter);
  const nowMs = useRelativeTimeTick(30_000);

  const visible = useMemo(
    () => filterRegistrySkills(registry.skills, filter, projectId),
    [registry.skills, filter, projectId],
  );

  const winners = useMemo(() => skillWinnersByName(registry.skills), [registry.skills]);

  if (registry.state === "unavailable") return null;

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}
      data-testid="skill-registry"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-26px font-semibold text-foreground">{t("Skill registry")}</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            {t(
              "Bots see a short index of skills, not the skills themselves. A skill's full instructions load only when a task needs it.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            aria-label={t("Filter skills")}
            variant="segmented"
            value={[filter]}
            onValueChange={(next) => {
              const value = next[0];

              if (isSkillRegistryFilter(value)) setFilter(value);
            }}
          >
            {SKILL_REGISTRY_FILTERS.map((option) => (
              <ToggleGroupItem key={option} value={option}>
                {t(FILTER_LABELS[option])}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button size="compact">
            <PlusIcon aria-hidden />
            {t("Add skill")}
          </Button>
        </div>
      </div>

      {registry.state === "loading" ? (
        <SkillRegistrySkeleton />
      ) : registry.state === "error" ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("The skill registry did not load.")}</EmptyTitle>
            <EmptyDescription>{t("Try again in a moment.")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : visible.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {filter === "unused" ? t("Every skill has been used") : t("No skills yet")}
            </EmptyTitle>
            <EmptyDescription>
              {filter === "unused"
                ? t("Skills appear here once a bot has loaded none of them.")
                : t("Skills a bot can load on demand show up here.")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Table>
            <SkillRegistryColumns />
            <TableBody>
              {visible.map((skill: RegistrySkill) => (
                <SkillRegistryRow
                  key={skill.id}
                  skill={skill}
                  winner={winners.get(skill.name)?.id === skill.id}
                  attention={skillAttention(skill, registry.unavailableConnectors)}
                  bots={bots}
                  nowMs={nowMs}
                  removeLabel={
                    skill.projectId === undefined
                      ? t("Remove from all spaces…")
                      : t("Remove from this space…")
                  }
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-11px text-muted-foreground">
        {t("Size is what loads when a skill is used. The index costs about 30 tokens per skill.")}
      </p>
    </div>
  );
}
