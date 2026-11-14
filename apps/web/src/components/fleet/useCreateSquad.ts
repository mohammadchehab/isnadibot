import type { FleetTemplateId } from "@isnadi/contracts";
import type { HireDraft } from "@isnadi/client-runtime/fleet/hire";
import { useNavigate } from "@tanstack/react-router";
import { Predicate } from "effect";
import { useCallback, useEffect, useState } from "react";

import { useI18n } from "../../i18n";
import { randomUUID } from "../../lib/utils";
import { botEnvironment } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentSnapshot } from "../../state/environmentSnapshot";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";

/** A hire the server accepted without saying which group it made, waiting on the snapshot. */
interface PendingHire {
  readonly templateId: FleetTemplateId;
  /** The groups the snapshot already showed, so the hire's own group is the new one. */
  readonly knownGroupIds: ReadonlySet<string>;
  /** The sequence the dispatch answered with; the group cannot be in an earlier snapshot. */
  readonly sequence: number;
}

/** What the screen calls to hire, and whether a hire it already accepted is still landing. */
interface CreateSquad {
  readonly create: (draft: HireDraft, onFailure: (draft: HireDraft) => void) => Promise<void>;
  /** A squad the server accepted whose group the shell snapshot has not shown yet. */
  readonly pending: boolean;
}

/**
 * Creates the squad squad setup is showing and lands on it.
 *
 * The hire is one command, so what it returns says what happened: a blocked or
 * failed hire hands the draft back so the screen keeps it, with the ids it
 * already sent still standing. A sent hire names the group the server minted,
 * so the screen lands on it at once. An environment that predates that id in
 * its answer leaves it out; then the screen waits for the shell snapshot to
 * pass the sequence the dispatch answered with and lands on the group that
 * hire added. A snapshot past that sequence without a new group means the hire
 * did not land; the screen says so rather than navigating somewhere else.
 */
export function useCreateSquad(): CreateSquad {
  const { t } = useI18n();
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const snapshot = useEnvironmentSnapshot();

  const [pending, setPending] = useState<PendingHire | null>(null);

  const hireCommand = useAtomCommand(botEnvironment.hire, { reportFailure: false });

  useEffect(() => {
    if (pending === null || snapshot === null) return;

    if (snapshot.snapshotSequence < pending.sequence) return;

    const group = snapshot.groups.find(
      (candidate) =>
        candidate.fleetTemplateId === pending.templateId &&
        !pending.knownGroupIds.has(candidate.id),
    );

    setPending(null);

    if (group === undefined) {
      toastManager.add({ type: "error", title: t("Could not create the space") });

      return;
    }

    void navigate({
      to: "/groups/$groupId",
      params: { groupId: group.id },
      search: { tab: "overview" },
    });
  }, [pending, snapshot, navigate, t]);

  const create = useCallback(
    async (draft: HireDraft, onFailure: (draft: HireDraft) => void) => {
      if (environmentId === null) {
        toastManager.add({ type: "error", title: t("Connect an environment first") });

        return;
      }

      const result = await hireCommand({
        environmentId,
        input: { draft, makeId: () => randomUUID() },
      });

      if (Predicate.isTagged(result, "Failure")) {
        toastManager.add({ type: "error", title: t("Could not create the space") });

        return;
      }

      const outcome = result.value;

      if (outcome.status !== "sent") {
        onFailure(outcome.status === "failed" ? outcome.draft : draft);
        toastManager.add({ type: "error", title: t("Could not create the space") });

        return;
      }

      if (outcome.groupId !== undefined) {
        void navigate({
          to: "/groups/$groupId",
          params: { groupId: outcome.groupId },
          search: { tab: "overview" },
        });

        return;
      }

      setPending({
        templateId: draft.templateId,
        knownGroupIds: new Set((snapshot?.groups ?? []).map((group) => group.id)),
        sequence: outcome.sequence,
      });
    },
    [environmentId, hireCommand, navigate, snapshot, t],
  );

  return { create, pending: pending !== null };
}
