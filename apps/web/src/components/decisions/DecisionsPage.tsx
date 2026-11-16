import { useI18n } from "../../i18n";
import { useAllEnvironmentShellsBootstrapped, useDecisions } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useOpenChat } from "../chat/useOpenChat";
import { PageTopBar } from "../PageTopBar";
import { SidebarInset } from "../ui/sidebar";
import { DecisionRow } from "./DecisionRow";
import { useDecisionOwner } from "./decisionOwner";
import { DecisionsEmpty, DecisionsLoading } from "./DecisionsStates";

/**
 * The sidebar's Decisions row lands here: one row per chat waiting on the user,
 * in a 720 column that goes full width with a 16 gutter below the 768
 * breakpoint. A row opens that exact chat and leaves the list when the prompt
 * is answered.
 */
export function DecisionsPage() {
  const { t } = useI18n();
  const decisions = useDecisions(usePrimaryEnvironmentId());
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const ownerOf = useDecisionOwner();
  const openChat = useOpenChat();

  return (
    <SidebarInset tone="foreground" className="h-dvh min-h-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageTopBar title={t("Decisions")} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-6">
          <div
            className="mx-auto flex w-(--spacing-min-45rem-pct-2rem) flex-col"
            data-testid="decisions-page"
          >
            {!bootstrapped ? (
              <DecisionsLoading />
            ) : decisions.length === 0 ? (
              <DecisionsEmpty />
            ) : (
              decisions.map((decision) => (
                <DecisionRow
                  key={decision.threadId}
                  decision={decision}
                  owner={ownerOf(decision)}
                  onOpen={() =>
                    void openChat({
                      environmentId: decision.environmentId,
                      threadId: decision.targetThreadId,
                    })
                  }
                />
              ))
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}
