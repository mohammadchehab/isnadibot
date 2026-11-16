import type { SkillId } from "@isnadi/contracts";
import {
  skillAddUrlIsGitHub,
  skillProviderGroups,
  skillSizeLabel,
  useSkillRegistryActions,
  type RegistrySkill,
  type SkillAddRefusal,
  type SkillAddRequest,
  type SkillAddScope,
  type SkillAddSource,
} from "@isnadi/client-runtime/skills";
import { Fragment, useState, type ReactNode } from "react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Radio, RadioGroup } from "../ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { SkillDialogLabel, SkillDialogNote } from "./SkillDialogBits";
import {
  chosenArchiveRefusal,
  SkillAddZipDropzone,
  type ChosenArchive,
} from "./SkillAddZipDropzone";

const SOURCE_LABELS = {
  provider: "From a provider",
  github: "GitHub URL",
  zip: ".zip",
} as const;

const SOURCE_DESCRIPTIONS = {
  provider: "A skill is a folder with a SKILL.md. Pick one to add to this space.",
  github: "Paste a GitHub link to a skill folder. Isnadi pins the commit it reads.",
  zip: "Upload a .zip of a skill folder. Isnadi checks it before adding anything.",
} as const;

const SCOPE_TITLES = { "this-space": "This space", "all-spaces": "All spaces" } as const;

const SCOPE_SUBTITLES = {
  "this-space": "Travels with this space's project.",
  "all-spaces": "Available in every space.",
} as const;

const SCOPES: readonly SkillAddScope[] = ["this-space", "all-spaces"];

function isSkillAddSource(value: string | undefined): value is SkillAddSource {
  return value === "provider" || value === "github" || value === "zip";
}

function isSkillAddScope(value: string): value is SkillAddScope {
  return value === "this-space" || value === "all-spaces";
}

/**
 * The request the dialog would send for the fields it holds, or null while the chosen source is
 * still missing what it needs: a picked provider skill, a GitHub link, or a readable archive.
 */
function skillAddRequest(input: {
  readonly source: SkillAddSource;
  readonly scope: SkillAddScope;
  readonly providerSkillId: string | undefined;
  readonly url: string;
  readonly archive: ChosenArchive | null;
}): SkillAddRequest | null {
  switch (input.source) {
    case "provider":
      if (input.providerSkillId === undefined) return null;

      return { source: "provider", scope: input.scope, input: input.providerSkillId };
    case "github":
      if (!skillAddUrlIsGitHub(input.url)) return null;

      return { source: "github", scope: input.scope, input: input.url };
    case "zip": {
      const archive = input.archive;

      if (archive === null || chosenArchiveRefusal(archive) !== null) return null;

      return {
        source: "zip",
        scope: input.scope,
        input: archive.name,
        sizeBytes: archive.sizeBytes,
        leadingBytes: archive.leadingBytes,
      };
    }
  }
}

/** One provider skill, picked with its radio; the whole row is the target. */
function SkillProviderRow({
  skill,
  selected,
  onSelect,
}: {
  readonly skill: RegistrySkill;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5",
        selected && "bg-muted",
      )}
    >
      <Radio value={skill.id} className="mt-0.5" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-13px leading-5 text-foreground">{skill.name}</span>
        <span className="text-11px leading-4 text-muted-foreground">{skill.description}</span>
      </span>
      <span className="text-11px leading-4 tabular-nums text-muted-foreground">
        {skillSizeLabel(skill.sizeTokens)}
      </span>
    </div>
  );
}

/** The two scope rows: this space's folder, or the user's, which every space sees. */
function SkillAddScopeRows({
  scope,
  onScopeChange,
}: {
  readonly scope: SkillAddScope;
  readonly onScopeChange: (next: SkillAddScope) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-3.5">
      <SkillDialogLabel>{t("Add to")}</SkillDialogLabel>
      <RadioGroup
        value={scope}
        onValueChange={(next) => {
          if (isSkillAddScope(next)) onScopeChange(next);
        }}
        className="gap-3.5"
      >
        {SCOPES.map((option) => (
          <div
            key={option}
            onClick={() => {
              onScopeChange(option);
            }}
            className={cn(
              "flex w-full cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5",
              scope === option && "bg-muted",
            )}
          >
            <Radio value={option} className="mt-0.5" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-13px font-medium leading-18px text-foreground">
                {t(SCOPE_TITLES[option])}
              </span>
              <span className="text-11px leading-4 text-muted-foreground">
                {t(SCOPE_SUBTITLES[option])}
              </span>
            </span>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}

/**
 * Add a skill: one dialog, three ways in, and the refusals each way draws. The source picker
 * swaps the body and nothing else, so the scope, the note and the footer stay where they are.
 *
 * The dialog asks the seam to add the skill and closes on `added`; a Community skill hands over
 * to the approval dialog instead, because nothing reaches a bot before the user reads it (D28).
 */
export function SkillAddDialog({
  skills,
  initialSource = "provider",
  onClose,
  onNeedsApproval,
}: {
  readonly skills: readonly RegistrySkill[];
  readonly initialSource?: SkillAddSource | undefined;
  readonly onClose: () => void;
  readonly onNeedsApproval: (skillId: SkillId) => void;
}) {
  const { t } = useI18n();
  const actions = useSkillRegistryActions();
  const [source, setSource] = useState<SkillAddSource>(initialSource);
  const [scope, setScope] = useState<SkillAddScope>("this-space");
  const [providerSkillId, setProviderSkillId] = useState<string | undefined>(undefined);
  const [url, setUrl] = useState("");
  const [archive, setArchive] = useState<ChosenArchive | null>(null);
  const [refusal, setRefusal] = useState<SkillAddRefusal | null>(null);

  const groups = skillProviderGroups(skills);
  const zipRefusal = chosenArchiveRefusal(archive);

  const request = skillAddRequest({ source, scope, providerSkillId, url, archive });
  const canSubmit = actions !== null && request !== null;

  const submit = (): void => {
    if (actions === null || request === null) return;

    const outcome = actions.addSkill(request);

    switch (outcome.kind) {
      case "refused":
        setRefusal(outcome.refusal);
        break;
      case "needs-approval":
        onNeedsApproval(outcome.skillId);
        break;
      case "added":
        onClose();
        break;
    }
  };

  const approvalNote = t(
    "A community skill needs your approval before a bot can use it. The next step shows what it does.",
  );

  let body: ReactNode;

  switch (source) {
    case "provider":
      body = (
        <>
          <RadioGroup
            value={providerSkillId ?? ""}
            onValueChange={(next) => {
              setProviderSkillId(next);
            }}
            className="gap-3.5"
          >
            {groups.map((group) => (
              <Fragment key={group.driver}>
                <SkillDialogLabel>{group.label}</SkillDialogLabel>
                {group.skills.map((skill) => (
                  <SkillProviderRow
                    key={skill.id}
                    skill={skill}
                    selected={skill.id === providerSkillId}
                    onSelect={() => {
                      setProviderSkillId(skill.id);
                    }}
                  />
                ))}
              </Fragment>
            ))}
          </RadioGroup>
          <SkillAddScopeRows scope={scope} onScopeChange={setScope} />
          <SkillDialogNote>
            {t("The provider keeps its copy. Isnadi adds its own, so every model keeps the skill.")}
          </SkillDialogNote>
        </>
      );
      break;
    case "github":
      body = (
        <>
          <SkillDialogLabel>{t("Skill URL")}</SkillDialogLabel>
          <Input
            value={url}
            aria-label={t("Skill URL")}
            onChange={(event) => {
              setUrl(event.target.value);
              setRefusal(null);
            }}
          />
          {refusal === "link-not-found" ? (
            <SkillDialogNote tone="destructive">
              {t(
                "No skill found at that link. Point at the folder that holds SKILL.md, not the repository root.",
              )}
            </SkillDialogNote>
          ) : (
            <SkillDialogNote>
              {t("Isnadi reads the ref, resolves it to a commit and fetches only that folder.")}
            </SkillDialogNote>
          )}
          <SkillAddScopeRows scope={scope} onScopeChange={setScope} />
          {refusal === "link-not-found" ? null : <SkillDialogNote>{approvalNote}</SkillDialogNote>}
        </>
      );
      break;
    case "zip":
      body = (
        <>
          <SkillAddZipDropzone
            archive={archive}
            refusal={zipRefusal}
            onChoose={(chosen) => {
              setArchive(chosen);
              setRefusal(null);
            }}
          />
          <SkillAddScopeRows scope={scope} onScopeChange={setScope} />
          {zipRefusal === null ? <SkillDialogNote>{approvalNote}</SkillDialogNote> : null}
        </>
      );
      break;
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{t("Add a skill")}</DialogTitle>
          <DialogDescription>{t(SOURCE_DESCRIPTIONS[source])}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-3.5">
            <ToggleGroup
              aria-label={t("Where the skill comes from")}
              variant="segmented"
              value={[source]}
              onValueChange={(next) => {
                const value = next[0];

                if (!isSkillAddSource(value)) return;

                setSource(value);
                setRefusal(null);
              }}
            >
              {(["provider", "github", "zip"] as const).map((option) => (
                <ToggleGroupItem key={option} value={option}>
                  {t(SOURCE_LABELS[option])}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {body}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {source === "github" ? t("Check the link") : t("Add skill")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
