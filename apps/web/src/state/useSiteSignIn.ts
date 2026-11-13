import type { SiteSignInRequestRecord } from "@isnadi/client-runtime/browser-auth";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type { SiteSignInFixtureSource } from "./siteSignInFixture";
import { loadSiteSignInFixtureSource } from "./siteSignInFixtureLoader";

const noSubscribe = () => () => {};

/** The active fixture source, or null in a shipped build where no sign-in request exists yet. */
export function useSiteSignInSource(): SiteSignInFixtureSource | null {
  const [source, setSource] = useState<SiteSignInFixtureSource | null>(null);

  useEffect(() => {
    let active = true;

    void loadSiteSignInFixtureSource().then((loaded) => {
      if (active) setSource(loaded);
    });

    return () => {
      active = false;
    };
  }, []);

  return source;
}

/**
 * The open sign-in request for this chat, seeded the way a real one arrives: when the chat has
 * nothing asking, the fixture asks for the demo site so the card appears where a real one would.
 */
export function useSiteSignInRequest(
  threadId: string | null,
  botId: string,
): SiteSignInRequestRecord | null {
  const source = useSiteSignInSource();

  useEffect(() => {
    if (source !== null && threadId !== null) source.ensureAsking(threadId, botId);
  }, [source, threadId, botId]);

  const subscribe = useCallback(
    (listener: () => void) => (source === null ? noSubscribe() : source.subscribe(listener)),
    [source],
  );

  const read = useCallback(
    () => (source === null || threadId === null ? null : source.recordForThread(threadId)),
    [source, threadId],
  );

  return useSyncExternalStore(subscribe, read);
}
