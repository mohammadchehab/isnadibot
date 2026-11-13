import { Predicate, Schema } from "effect";
import { HireFleetError, type HireDraft } from "@isnadi/client-runtime/fleet/hire";
import { squashAtomCommandFailure } from "@isnadi/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { useI18n } from "../../i18n";
import { randomUUID } from "../../lib/utils";
import { botEnvironment } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";

const isHireFleetError = Schema.is(HireFleetError);

/**
 * Creates the squad squad setup is showing and lands on it.
 *
 * A hire that stopped hands its failure back so the screen keeps the draft:
 * the command ids it already sent stay as they are, and the next Create only
 * mints a fresh id for a member whose engine was edited after that attempt.
 */
export function useCreateSquad(): (
  draft: HireDraft,
  onFailure: (failure: HireFleetError) => void,
) => Promise<void> {
  const { t } = useI18n();
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();

  const hireCommand = useAtomCommand(botEnvironment.hire, { reportFailure: false });

  return useCallback(
    async (draft: HireDraft, onFailure: (failure: HireFleetError) => void) => {
      if (environmentId === null) {
        toastManager.add({ type: "error", title: t("Connect an environment first") });

        return;
      }

      const result = await hireCommand({
        environmentId,
        input: { draft, makeId: () => randomUUID() },
      });

      if (Predicate.isTagged(result, "Failure")) {
        const error = squashAtomCommandFailure(result);

        if (isHireFleetError(error)) onFailure(error);

        toastManager.add({ type: "error", title: t("Could not create the space") });

        return;
      }

      void navigate({ to: "/groups/$groupId", params: { groupId: result.value.groupId } });
    },
    [environmentId, hireCommand, navigate, t],
  );
}
