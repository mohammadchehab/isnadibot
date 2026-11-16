import {
  skillAddFileSizeLabel,
  skillAddZipRefusal,
  type SkillAddRefusal,
} from "@isnadi/client-runtime/skills";
import { useRef } from "react";

import { useI18n } from "../../i18n";
import { Button } from "../ui/button";
import { SkillDialogNote } from "./SkillDialogBits";

/** The archive the user chose, read just far enough to refuse a file that is not a zip. */
export type ChosenArchive = {
  readonly name: string;
  readonly sizeBytes: number;
  readonly leadingBytes: readonly number[];
};

/** Reads the archive's size and first two bytes; the rest of the file never leaves the browser. */
async function readArchive(file: File): Promise<ChosenArchive> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());

  return { name: file.name, sizeBytes: file.size, leadingBytes: [...head] };
}

/**
 * The .zip half of the Add a skill dialog: a dropzone at rest, and the same dropzone in the
 * refusal state the frames draw, with a destructive helper and a button that asks for another
 * file. The refusal is worked out here, so the footer's primary can stay inert while it stands.
 */
export function SkillAddZipDropzone({
  archive,
  refusal,
  onChoose,
}: {
  readonly archive: ChosenArchive | null;
  readonly refusal: SkillAddRefusal | null;
  readonly onChoose: (archive: ChosenArchive) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  const refused = archive !== null && refusal !== null;

  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border bg-muted/50 px-4 py-5">
      <p className="text-13px leading-5 text-foreground">
        {refused
          ? refusal === "zip-too-big"
            ? t("That .zip is {size}", { size: skillAddFileSizeLabel(archive.sizeBytes) })
            : t("That .zip has a link inside")
          : t("Drop a .zip here")}
      </p>
      <SkillDialogNote tone={refused ? "destructive" : "muted"}>
        {refused
          ? refusal === "zip-too-big"
            ? t("The limit is 5 MB. Remove the large files and try again.")
            : t(
                "Archives may hold up to 200 plain files. Remove symlinks, absolute paths and executables, then try again.",
              )
          : t("Up to 5 MB and 200 files. No symlinks or executables.")}
      </SkillDialogNote>
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        className="hidden"
        data-testid="skill-add-archive"
        onChange={(event) => {
          const file = event.target.files?.[0];

          // Cleared, so choosing the same file twice asks again instead of doing nothing.
          event.target.value = "";

          if (file === undefined) return;

          void readArchive(file).then((chosen) => {
            onChoose(chosen);
          });
        }}
      />
      <Button size="xs" onClick={() => inputRef.current?.click()}>
        {refused ? t("Choose a different file") : t("Choose a file")}
      </Button>
    </div>
  );
}

/** The refusal the chosen archive earns on its own, before the source is asked anything. */
export function chosenArchiveRefusal(archive: ChosenArchive | null): SkillAddRefusal | null {
  return archive === null ? null : skillAddZipRefusal(archive);
}
