import { createFileRoute, redirect } from "@tanstack/react-router";

import { SpaceSettingsPage } from "../components/space/SpaceSettingsPage";

export const Route = createFileRoute("/groups/$groupId/settings")({
  beforeLoad: async ({ context }) => {
    if (context.authGateState.status !== "authenticated") {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: () => <SpaceSettingsPage groupId={Route.useParams().groupId} />,
});
