import { lazy, Suspense, useState } from "react";
import type { SiteSignInCardAction } from "@isnadi/client-runtime/browser-auth";

import type { SiteSignInFixtureSource } from "../../state/siteSignInFixture";
import { useSiteSignInRequest, useSiteSignInSource } from "../../state/useSiteSignIn";
import { SiteSignInCard } from "./SiteSignInCard";
import { SiteSignInFormDialog } from "./SiteSignInFormDialog";

/** The dev picker is a separate chunk that a shipped build never asks for. */
const SiteSignInFixturePicker = lazy(() =>
  import("../dev/SiteSignInFixturePicker").then((module) => ({
    default: module.SiteSignInFixturePicker,
  })),
);

const sendAction = (
  source: SiteSignInFixtureSource,
  requestId: string,
  action: Exclude<SiteSignInCardAction, "save-again">,
) => {
  const now = Date.now();

  switch (action) {
    case "sign-in":
    case "sign-in-again":
      source.act(requestId, { type: "start", now });

      return;
    case "continue-sign-in":
      source.act(requestId, { type: "join", now });

      return;
    case "keep-flow":
      source.act(requestId, { type: "keep-flow", now });

      return;
    case "cancel":
      source.act(requestId, { type: "cancel", now });

      return;
    case "not-now":
      source.act(requestId, { type: "dismiss", now });

      return;
    case "allow":
      source.act(requestId, { type: "allow", now });

      return;
    case "retry":
      source.act(requestId, { type: "retry", now });

      return;
  }
};

/**
 * The sign-in card for one chat, docked on the composer where the approval prompts sit. On
 * fixtures the request is seeded for the open chat and the dev picker can set the record; in a
 * shipped build there is no request yet, so this renders nothing.
 */
export function SiteSignInCardSlot({
  threadId,
  botId,
  botName,
}: {
  readonly threadId: string | null;
  readonly botId: string;
  readonly botName: string;
}) {
  const source = useSiteSignInSource();
  const record = useSiteSignInRequest(threadId, botId);
  const [formOpen, setFormOpen] = useState(false);

  if (source === null || record === null) return null;

  return (
    <>
      {import.meta.env.DEV ? (
        <Suspense fallback={null}>
          <SiteSignInFixturePicker record={record} source={source} />
        </Suspense>
      ) : null}
      <SiteSignInCard
        record={record}
        botName={botName}
        onAction={(action) => {
          if (action === "save-again") {
            setFormOpen(true);

            return;
          }

          sendAction(source, record.requestId, action);
        }}
        onOpenForm={() => {
          if (record.state === "asking") sendAction(source, record.requestId, "sign-in");

          if (record.state === "failed") sendAction(source, record.requestId, "sign-in-again");

          setFormOpen(true);
        }}
      />
      <SiteSignInFormDialog
        record={record}
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={() => source.submitForm(record.requestId)}
        onCancel={() => source.act(record.requestId, { type: "cancel", now: Date.now() })}
      />
    </>
  );
}
