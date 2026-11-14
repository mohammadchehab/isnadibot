import { createFileRoute } from "@tanstack/react-router";

import { StartSpaceScreen } from "../components/fleet/StartSpaceScreen";

export const Route = createFileRoute("/_chat/spaces/new/")({
  component: StartSpaceScreen,
});
