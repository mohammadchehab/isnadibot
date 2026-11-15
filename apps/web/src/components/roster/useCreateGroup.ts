import { Predicate } from "effect";
import { BotId, GroupId } from "@isnadi/contracts";
import {
  classifyCommandFailure,
  commandFailureMessage,
} from "@isnadi/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { useI18n } from "../../i18n";
import { randomUUID } from "../../lib/utils";
import { botEnvironment } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import type { NewGroupInput } from "./NewGroupDialog";

/** What a caller can do once the group exists, beyond landing on it. */
export type CreateGroupResult = GroupId | null;

/**
 * Creates a group and lands on it. The roster's New space menu and the empty
 * start on the fleet screens both go through this one hook, so a group is
 * created and opened the same way wherever the user starts one.
 *
 * Resolves with the new group's id, or null when the create did not happen and
 * the user has already been told why.
 */
export function useCreateGroup(): (input: NewGroupInput) => Promise<CreateGroupResult> {
  const { t } = useI18n();
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();

  const createGroupCommand = useAtomCommand(botEnvironment.groups.create, {
    reportFailure: false,
  });

  return useCallback(
    async (input: NewGroupInput) => {
      if (environmentId === null) {
        toastManager.add({
          type: "error",
          title: t("Connect an environment first"),
        });

        return null;
      }

      const groupId = GroupId.make(`group-${randomUUID()}`);

      const result = await createGroupCommand({
        environmentId,
        input: {
          groupId,
          name: input.name,
          bossBotId: BotId.make(input.bossBotId),
          specialistBotIds: input.specialistBotIds.map((botId) => BotId.make(botId)),
        },
      });

      if (!Predicate.isTagged(result, "Failure")) {
        void navigate({ to: "/groups/$groupId", params: { groupId } });

        return groupId;
      }

      // Only a refusal this client can name may carry a description; anything
      // else keeps the title-only toast rather than echoing the server's own
      // sentence with its raw bot and group ids. `unknown` covers two cases and
      // title-only is right for both: a throw the server has not coded yet, and
      // a coded refusal from a newer server whose code this client lacks.
      //
      // INTERIM — TASK-288 and TASK-303 code these throws; removing the gate
      // restores the echo fallback for newer-server codes, which TASK-294
      // decides. Same gate TASK-289 put on the group editor.
      if (classifyCommandFailure(result) === "unknown") {
        toastManager.add({ type: "error", title: t("Could not create group") });

        return null;
      }

      toastManager.add({
        type: "error",
        title: t("Could not create group"),
        description: commandFailureMessage(result, { t }),
      });

      return null;
    },
    [createGroupCommand, environmentId, navigate, t],
  );
}
