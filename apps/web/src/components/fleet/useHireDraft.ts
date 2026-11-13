import { useAtomValue } from "@effect/atom-react";
import {
  type FleetRoleId,
  type FleetTemplate,
  type GroupHopBudget,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ServerProvider,
} from "@isnadi/contracts";
import {
  createHireDraft,
  draftBlockers,
  setBoss,
  setHopBudget,
  setMemberModel,
  setMemberReasoning,
  type HireDraft,
} from "@isnadi/client-runtime/fleet/hire";
import { useEffect, useMemo, useRef, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { primaryServerProvidersAtom } from "../../state/server";

function newDraft(template: FleetTemplate, providers: ReadonlyArray<ServerProvider>): HireDraft {
  return createHireDraft({
    template,
    providers,
    makeId: () => randomUUID(),
    createdAt: new Date().toISOString(),
  });
}

/**
 * Squad setup's working copy of a hire, plus the provider catalog its pickers
 * share. The screen holds the draft in state, so leaving the screen drops it:
 * nothing is created until the user presses Create.
 *
 * A draft nobody has edited is rebuilt when the provider list arrives, so a
 * member seeded while the server was still answering is seeded again by what
 * the server actually offers.
 */
export function useHireDraft(template: FleetTemplate) {
  const providers = useAtomValue(primaryServerProvidersAtom);
  const settings = usePrimarySettings();
  const [draft, setDraft] = useState<HireDraft>(() => newDraft(template, providers));
  const edited = useRef(false);
  const seededFrom = useRef(providers);

  useEffect(() => {
    if (edited.current || seededFrom.current === providers) return;

    seededFrom.current = providers;
    setDraft(newDraft(template, providers));
  }, [providers, template]);

  const edit = (change: (current: HireDraft) => HireDraft) => {
    edited.current = true;
    setDraft(change);
  };

  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
      ),
    [providers, settings],
  );

  const modelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(settings, providers),
    [providers, settings],
  );

  return {
    draft,
    blockers: draftBlockers(draft),
    instanceEntries,
    modelOptionsByInstance,
    pickBoss: (roleId: FleetRoleId) => {
      edit((current) => setBoss(current, roleId));
    },
    pickHopBudget: (budget: GroupHopBudget) => {
      edit((current) => setHopBudget(current, budget));
    },
    pickModel: (roleId: FleetRoleId, instanceId: ProviderInstanceId, model: string) => {
      edit((current) => setMemberModel(current, roleId, { instanceId, model }, providers));
    },
    pickReasoning: (roleId: FleetRoleId, options: ReadonlyArray<ProviderOptionSelection>) => {
      edit((current) => setMemberReasoning(current, roleId, options));
    },
  };
}
