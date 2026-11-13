import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { BrowserProfileCheckRepositoryLive } from "./BrowserProfileChecks.ts";
import { BrowserProfileLeaseRepositoryLive } from "./BrowserProfileLeases.ts";
import { ProjectionBrowserAuthRequestRepositoryLive } from "./ProjectionBrowserAuthRequests.ts";
import { ProjectionBrowserProfileRepositoryLive } from "./ProjectionBrowserProfiles.ts";
import { ProjectionBrowserSessionGrantRepositoryLive } from "./ProjectionBrowserSessionGrants.ts";
import { BrowserProfileCheckRepository } from "../Services/BrowserProfileChecks.ts";
import { BrowserProfileLeaseRepository } from "../Services/BrowserProfileLeases.ts";
import {
  ProjectionBrowserAuthRequestRepository,
  type ProjectionBrowserAuthRequest,
} from "../Services/ProjectionBrowserAuthRequests.ts";
import {
  ProjectionBrowserProfileRepository,
  type ProjectionBrowserProfile,
} from "../Services/ProjectionBrowserProfiles.ts";
import { ProjectionBrowserSessionGrantRepository } from "../Services/ProjectionBrowserSessionGrants.ts";
import { BrowserProfileId } from "../../browserAuth/profileId.ts";

const ProfileAlpha = BrowserProfileId.make("3f1a1c62-8f4a-4a2c-9c3f-2b0a1d5e7f90");

const ProfileBeta = BrowserProfileId.make("8c2b4d76-1e5f-4b3a-8d6c-0a9e2f4b6c18");

const repositoriesLayer = it.layer(
  Layer.mergeAll(
    ProjectionBrowserProfileRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionBrowserAuthRequestRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionBrowserSessionGrantRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    BrowserProfileLeaseRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    BrowserProfileCheckRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

/** The memory client is shared by every test in this file, so each one begins from empty tables. */
const resetTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`DELETE FROM browser_profile_checks`;
  yield* sql`DELETE FROM browser_profile_leases`;
  yield* sql`DELETE FROM projection_browser_session_grants`;
  yield* sql`DELETE FROM projection_browser_auth_requests`;
  yield* sql`DELETE FROM projection_browser_profiles`;
});

const profile = (
  profileId: BrowserProfileId,
  overrides: Partial<ProjectionBrowserProfile> = {},
): ProjectionBrowserProfile => ({
  profileId,
  site: "alpha.example.com",
  label: null,
  authCheckUrl: null,
  authHosts: [],
  route: "direct",
  generation: 0,
  status: "signed-in",
  health: "unknown",
  lastWriteId: null,
  createdAt: "2026-11-12T00:00:00.000Z",
  updatedAt: "2026-11-12T00:00:00.000Z",
  signedOutAt: null,
  ...overrides,
});

const botRequest = (
  overrides: Partial<ProjectionBrowserAuthRequest> = {},
): ProjectionBrowserAuthRequest => ({
  requestId: "request-1",
  kind: "sign-in",
  requestedBy: "bot",
  botId: "bot-1",
  threadId: "thread-1",
  turnId: "turn-1",
  toolCallId: "call-1",
  groupId: null,
  site: "alpha.example.com",
  startUrl: null,
  reason: null,
  profileId: null,
  state: "asking",
  failureClass: null,
  submitting: false,
  flowId: null,
  startedByClient: null,
  askingElapsedMs: 0,
  askingSince: "2026-11-12T00:00:00.000Z",
  createdAt: "2026-11-12T00:00:00.000Z",
  updatedAt: "2026-11-12T00:00:00.000Z",
  settledAt: null,
  ...overrides,
});

repositoriesLayer("browser-auth repositories", (it) => {
  it.effect("a sign-out is a tombstone at generation + 1 and a stale generation is refused", () =>
    Effect.gen(function* () {
      const profiles = yield* ProjectionBrowserProfileRepository;

      yield* resetTables;
      yield* profiles.upsert(profile(ProfileAlpha));

      assert.isTrue(
        yield* profiles.signOut({
          profileId: ProfileAlpha,
          generation: 0,
          now: "2026-11-12T01:00:00.000Z",
        }),
      );

      const tombstone = yield* profiles.getById(ProfileAlpha);

      assert.deepStrictEqual(
        Option.map(tombstone, (row) => ({
          generation: row.generation,
          status: row.status,
          health: row.health,
          signedOutAt: row.signedOutAt,
        })),
        Option.some({
          generation: 1,
          status: "signed-out",
          health: "unknown",
          signedOutAt: "2026-11-12T01:00:00.000Z",
        }),
      );

      // A second sign-out from the generation that lost is a no-op, not a second bump.
      assert.isFalse(
        yield* profiles.signOut({
          profileId: ProfileAlpha,
          generation: 0,
          now: "2026-11-12T01:00:01.000Z",
        }),
      );

      assert.deepStrictEqual(
        Option.map(tombstone, (row) => row.generation),
        Option.some(1),
      );
      assert.deepStrictEqual(yield* profiles.listLive(), []);
    }),
  );

  it.effect("a sign-in reuses the row, and only from the generation it read", () =>
    Effect.gen(function* () {
      const profiles = yield* ProjectionBrowserProfileRepository;

      yield* resetTables;
      yield* profiles.upsert(profile(ProfileAlpha));
      yield* profiles.signOut({
        profileId: ProfileAlpha,
        generation: 0,
        now: "2026-11-12T01:00:00.000Z",
      });

      assert.isFalse(
        yield* profiles.signIn({
          profileId: ProfileAlpha,
          generation: 0,
          authCheckUrl: null,
          lastWriteId: "stale",
          now: "2026-11-12T01:00:01.000Z",
        }),
      );

      assert.isTrue(
        yield* profiles.signIn({
          profileId: ProfileAlpha,
          generation: 1,
          authCheckUrl: "https://alpha.example.com/account",
          lastWriteId: "write-2",
          now: "2026-11-12T01:00:02.000Z",
        }),
      );

      const signedIn = yield* profiles.getById(ProfileAlpha);

      assert.deepStrictEqual(
        Option.map(signedIn, (row) => ({
          generation: row.generation,
          status: row.status,
          lastWriteId: row.lastWriteId,
          signedOutAt: row.signedOutAt,
        })),
        Option.some({
          generation: 2,
          status: "signed-in",
          lastWriteId: "write-2",
          signedOutAt: null,
        }),
      );

      assert.deepStrictEqual(
        (yield* profiles.listLive()).map((row) => row.profileId),
        [ProfileAlpha],
      );
    }),
  );

  it.effect("deleting a profile cascades to its grants, lease and check, and nulls a request", () =>
    Effect.gen(function* () {
      const profiles = yield* ProjectionBrowserProfileRepository;
      const requests = yield* ProjectionBrowserAuthRequestRepository;
      const grants = yield* ProjectionBrowserSessionGrantRepository;
      const leases = yield* BrowserProfileLeaseRepository;
      const checks = yield* BrowserProfileCheckRepository;

      yield* resetTables;
      yield* profiles.upsert(profile(ProfileAlpha));
      yield* requests.upsert(botRequest({ profileId: ProfileAlpha }));
      yield* grants.upsert({
        grantId: "grant-1",
        profileId: ProfileAlpha,
        botId: "bot-1",
        threadId: "thread-1",
        site: "alpha.example.com",
        createdAt: "2026-11-12T00:00:00.000Z",
        lastUsedAt: "2026-11-12T00:00:00.000Z",
      });
      yield* leases.acquire({
        profileId: ProfileAlpha,
        holderId: "holder-1",
        now: "2026-11-12T00:00:00.000Z",
        expiresAt: "2026-11-12T00:00:30.000Z",
      });
      yield* checks.record({
        profileId: ProfileAlpha,
        result: "ok",
        checkedAt: "2026-11-12T00:00:00.000Z",
        expiryEpisode: 0,
        autoResignEpisode: null,
      });

      assert.isTrue(yield* profiles.delete(ProfileAlpha));

      assert.deepStrictEqual(
        (yield* requests.getById("request-1")).pipe(Option.map((row) => row.profileId)),
        Option.some(null),
      );
      assert.deepStrictEqual(
        yield* grants.listForBotThread({ botId: "bot-1", threadId: "thread-1" }),
        [],
      );
      assert.deepStrictEqual(yield* leases.get(ProfileAlpha), Option.none());
      assert.deepStrictEqual(yield* checks.get(ProfileAlpha), Option.none());
    }),
  );

  it.effect(
    "requests list as open only while they wait, and a thread delete takes all of them",
    () =>
      Effect.gen(function* () {
        const requests = yield* ProjectionBrowserAuthRequestRepository;

        yield* resetTables;
        yield* requests.upsert(botRequest({ requestId: "asking", state: "asking" }));
        yield* requests.upsert(
          botRequest({
            requestId: "in-progress",
            state: "in-progress",
            createdAt: "2026-11-12T00:00:01.000Z",
          }),
        );
        yield* requests.upsert(botRequest({ requestId: "signed-in", state: "signed-in" }));
        yield* requests.upsert(
          botRequest({ requestId: "other-thread", threadId: "thread-2", state: "asking" }),
        );

        // Open requests come oldest first; two written in the same instant fall back to the id.
        assert.deepStrictEqual(
          (yield* requests.listOpen()).map((row) => row.requestId),
          ["asking", "other-thread", "in-progress"],
        );
        assert.deepStrictEqual(
          (yield* requests.listByThread("thread-1")).map((row) => row.requestId),
          ["asking", "signed-in", "in-progress"],
        );
        assert.strictEqual(yield* requests.deleteByThread("thread-1"), 3);
        assert.deepStrictEqual(
          (yield* requests.listOpen()).map((row) => row.requestId),
          ["other-thread"],
        );
      }),
  );

  it.effect(
    "a repeated grant refreshes the one row and the expiry sweep removes the quiet ones",
    () =>
      Effect.gen(function* () {
        const profiles = yield* ProjectionBrowserProfileRepository;
        const grants = yield* ProjectionBrowserSessionGrantRepository;

        yield* resetTables;
        yield* profiles.upsert(profile(ProfileAlpha));
        yield* grants.upsert({
          grantId: "grant-1",
          profileId: ProfileAlpha,
          botId: "bot-1",
          threadId: "thread-1",
          site: "alpha.example.com",
          createdAt: "2026-11-12T00:00:00.000Z",
          lastUsedAt: "2026-11-12T00:00:00.000Z",
        });
        yield* grants.upsert({
          grantId: "grant-2",
          profileId: ProfileAlpha,
          botId: "bot-1",
          threadId: "thread-1",
          site: "alpha.example.com",
          createdAt: "2026-11-12T01:00:00.000Z",
          lastUsedAt: "2026-11-12T01:00:00.000Z",
        });

        const stored = yield* grants.listForBotThread({ botId: "bot-1", threadId: "thread-1" });

        assert.deepStrictEqual(
          stored.map((row) => ({ grantId: row.grantId, lastUsedAt: row.lastUsedAt })),
          [{ grantId: "grant-1", lastUsedAt: "2026-11-12T01:00:00.000Z" }],
        );

        assert.isTrue(yield* grants.touch({ grantId: "grant-1", now: "2026-11-12T02:00:00.000Z" }));
        assert.deepStrictEqual(
          (yield* grants.listForBotThread({ botId: "bot-1", threadId: "thread-1" })).map(
            (row) => row.lastUsedAt,
          ),
          ["2026-11-12T02:00:00.000Z"],
        );
        assert.strictEqual(yield* grants.deleteExpired("2026-11-12T03:00:00.000Z"), 1);
        assert.deepStrictEqual(
          yield* grants.listForBotThread({ botId: "bot-1", threadId: "thread-1" }),
          [],
        );

        // A thread delete takes its grants with it, the same way it takes its requests.
        for (const threadId of ["thread-1", "thread-2"]) {
          yield* grants.upsert({
            grantId: `grant-${threadId}`,
            profileId: ProfileAlpha,
            botId: "bot-1",
            threadId,
            site: "alpha.example.com",
            createdAt: "2026-11-12T04:00:00.000Z",
            lastUsedAt: "2026-11-12T04:00:00.000Z",
          });
        }

        assert.strictEqual(yield* grants.deleteByThread("thread-1"), 1);
        assert.deepStrictEqual(
          (yield* grants.listForBotThread({ botId: "bot-1", threadId: "thread-2" })).map(
            (row) => row.grantId,
          ),
          ["grant-thread-2"],
        );
      }),
  );

  it.effect("one writer holds the lease, and the token only ever grows", () =>
    Effect.gen(function* () {
      const profiles = yield* ProjectionBrowserProfileRepository;
      const leases = yield* BrowserProfileLeaseRepository;

      yield* resetTables;
      yield* profiles.upsert(profile(ProfileAlpha));

      const first = yield* leases.acquire({
        profileId: ProfileAlpha,
        holderId: "holder-1",
        now: "2026-11-12T00:00:00.000Z",
        expiresAt: "2026-11-12T00:00:30.000Z",
      });

      assert.deepStrictEqual(
        Option.map(first, (row) => row.fencingToken),
        Option.some(1),
      );

      // A live lease refuses the second holder, and the refused holder learns nothing about ours.
      assert.deepStrictEqual(
        yield* leases.acquire({
          profileId: ProfileAlpha,
          holderId: "holder-2",
          now: "2026-11-12T00:00:10.000Z",
          expiresAt: "2026-11-12T00:00:40.000Z",
        }),
        Option.none(),
      );
      assert.isFalse(
        yield* leases.renew({
          profileId: ProfileAlpha,
          holderId: "holder-2",
          fencingToken: 1,
          now: "2026-11-12T00:00:10.000Z",
          expiresAt: "2026-11-12T00:00:40.000Z",
        }),
      );

      assert.isTrue(
        yield* leases.renew({
          profileId: ProfileAlpha,
          holderId: "holder-1",
          fencingToken: 1,
          now: "2026-11-12T00:00:10.000Z",
          expiresAt: "2026-11-12T00:00:40.000Z",
        }),
      );

      // An expired lease is taken over at the next token.
      const takeover = yield* leases.acquire({
        profileId: ProfileAlpha,
        holderId: "holder-2",
        now: "2026-11-12T00:00:41.000Z",
        expiresAt: "2026-11-12T00:01:11.000Z",
      });

      assert.deepStrictEqual(
        Option.map(takeover, (row) => ({ holderId: row.holderId, fencingToken: row.fencingToken })),
        Option.some({ holderId: "holder-2", fencingToken: 2 }),
      );

      // The holder that lost its lease is fenced by its token, not by the row disappearing.
      assert.isFalse(
        yield* leases.renew({
          profileId: ProfileAlpha,
          holderId: "holder-1",
          fencingToken: 1,
          now: "2026-11-12T00:00:42.000Z",
          expiresAt: "2026-11-12T00:01:12.000Z",
        }),
      );
      assert.isFalse(
        yield* leases.release({
          profileId: ProfileAlpha,
          holderId: "holder-1",
          fencingToken: 1,
        }),
      );

      assert.isTrue(
        yield* leases.release({
          profileId: ProfileAlpha,
          holderId: "holder-2",
          fencingToken: 2,
        }),
      );

      // Release keeps the row and its token, so the row survives with nothing held.
      const released = yield* leases.get(ProfileAlpha);

      assert.deepStrictEqual(
        Option.map(released, (row) => ({
          holderId: row.holderId,
          fencingToken: row.fencingToken,
          expiresAt: row.expiresAt,
        })),
        Option.some({ holderId: null, fencingToken: 2, expiresAt: null }),
      );

      const third = yield* leases.acquire({
        profileId: ProfileAlpha,
        holderId: "holder-3",
        now: "2026-11-12T00:01:20.000Z",
        expiresAt: "2026-11-12T00:01:50.000Z",
      });

      assert.deepStrictEqual(
        Option.map(third, (row) => row.fencingToken),
        Option.some(3),
      );
    }),
  );

  it.effect("a check is recorded per profile and the latest one wins", () =>
    Effect.gen(function* () {
      const profiles = yield* ProjectionBrowserProfileRepository;
      const checks = yield* BrowserProfileCheckRepository;

      yield* resetTables;
      yield* profiles.upsert(profile(ProfileAlpha));
      yield* profiles.upsert(profile(ProfileBeta, { site: "beta.example.com" }));

      assert.deepStrictEqual(yield* checks.get(ProfileAlpha), Option.none());

      yield* checks.record({
        profileId: ProfileAlpha,
        result: "expired",
        checkedAt: "2026-11-12T00:00:00.000Z",
        expiryEpisode: 1,
        autoResignEpisode: null,
      });
      yield* checks.record({
        profileId: ProfileAlpha,
        result: "ok",
        checkedAt: "2026-11-12T00:10:00.000Z",
        expiryEpisode: 0,
        autoResignEpisode: 1,
      });

      const stored = yield* checks.get(ProfileAlpha);

      assert.deepStrictEqual(
        Option.map(stored, (row) => ({
          result: row.result,
          checkedAt: row.checkedAt,
          expiryEpisode: row.expiryEpisode,
          autoResignEpisode: row.autoResignEpisode,
        })),
        Option.some({
          result: "ok",
          checkedAt: "2026-11-12T00:10:00.000Z",
          expiryEpisode: 0,
          autoResignEpisode: 1,
        }),
      );
      assert.deepStrictEqual(yield* checks.get(ProfileBeta), Option.none());
    }),
  );
});
