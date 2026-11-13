import { createFileRoute } from "@tanstack/react-router";

import { SquadSetupScreen } from "../components/fleet/SquadSetupScreen";

function SquadSetupRouteView() {
  const { templateId } = Route.useParams();

  return <SquadSetupScreen templateId={templateId} />;
}

export const Route = createFileRoute("/_chat/spaces/new/$templateId")({
  component: SquadSetupRouteView,
});
