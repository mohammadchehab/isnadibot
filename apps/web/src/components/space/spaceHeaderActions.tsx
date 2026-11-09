import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The element inside the space top bar that holds page actions. The space owns the top bar, but
 * the chat panel owns the controls (hop budget, chat menu), so the panel portals them up here.
 * `null` until the space view has mounted its bar.
 */
export const SpaceHeaderActionsHost = createContext<HTMLElement | null>(null);

/** Renders page actions into the space top bar; renders nothing when the space is not on screen. */
export function SpaceHeaderActions({ children }: { children: ReactNode }) {
  const host = useContext(SpaceHeaderActionsHost);

  return host === null ? null : createPortal(children, host);
}
