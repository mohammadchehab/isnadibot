import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The browser-auth base: one row per site, the sign-in request the owner and a bot both look
 * at, the session grants that say which bot may use a profile, and the two service tables the
 * lease (TASK-25) and the health check (TASK-50) keep. Ciphertext never lives here: the profile
 * row holds a generation, and the encrypted storage state stays on disk under
 * `<stateDir>/browser-profiles/`. See docs/internals/site-signin.md.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One row per site, reused on re-sign-in. Sign out keeps the row as a tombstone at
  // generation + 1, so a flow that began before the sign-out can never win the generation check.
  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_browser_profiles (
      profile_id TEXT PRIMARY KEY,
      site TEXT NOT NULL UNIQUE,
      label TEXT,
      auth_check_url TEXT,
      auth_hosts TEXT NOT NULL DEFAULT '[]' CHECK (
        json_valid(auth_hosts)
        AND json_type(auth_hosts) = 'array'
        AND json_array_length(auth_hosts) <= 10
      ),
      route TEXT NOT NULL CHECK (route IN ('direct', 'pc')),
      generation INTEGER NOT NULL CHECK (generation >= 0),
      status TEXT NOT NULL CHECK (status IN ('signed-in', 'signed-out')),
      health TEXT NOT NULL CHECK (health IN ('ok', 'expired', 'unknown')),
      last_write_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      signed_out_at TEXT
    )
  `;

  // The durable thing a bot asks for and the owner answers. There is no `cancelled` state and no
  // `expires_at`: Cancel returns a bot's request to `asking`, and the 10-minute wait is derived
  // from `asking_elapsed_ms` plus `asking_since`, so an owner-started request has no wait at all.
  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_browser_auth_requests (
      request_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('sign-in', 'access')),
      requested_by TEXT NOT NULL CHECK (requested_by IN ('bot', 'owner')),
      bot_id TEXT,
      thread_id TEXT,
      turn_id TEXT,
      tool_call_id TEXT,
      group_id TEXT,
      site TEXT NOT NULL,
      start_url TEXT,
      reason TEXT CHECK (reason IS NULL OR length(reason) <= 500),
      profile_id TEXT REFERENCES projection_browser_profiles(profile_id) ON DELETE SET NULL,
      state TEXT NOT NULL CHECK (
        state IN ('asking', 'in-progress', 'signed-in', 'failed', 'dismissed', 'expired')
      ),
      failure_class TEXT,
      submitting INTEGER NOT NULL DEFAULT 0 CHECK (submitting IN (0, 1)),
      flow_id TEXT,
      started_by_client TEXT,
      asking_elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK (asking_elapsed_ms >= 0),
      asking_since TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      settled_at TEXT,
      CHECK (
        requested_by = 'owner'
        OR (bot_id IS NOT NULL AND thread_id IS NOT NULL AND tool_call_id IS NOT NULL)
      )
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_browser_auth_requests_thread
    ON projection_browser_auth_requests(thread_id, created_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_browser_auth_requests_bot_open
    ON projection_browser_auth_requests(bot_id)
    WHERE state IN ('asking', 'in-progress')
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_browser_auth_requests_open
    ON projection_browser_auth_requests(state)
    WHERE state IN ('asking', 'in-progress')
  `;

  // A grant says one bot may use one profile inside one thread. `UNIQUE` keeps a repeated
  // approval from stacking, and expiry is derived from `last_used_at` rather than stored.
  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_browser_session_grants (
      grant_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES projection_browser_profiles(profile_id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      site TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      UNIQUE (profile_id, bot_id, thread_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_browser_session_grants_bot
    ON projection_browser_session_grants(bot_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_browser_session_grants_thread
    ON projection_browser_session_grants(thread_id)
  `;

  // One lease row per profile, kept across release: release clears the holder and the row's
  // `fencing_token` only ever grows, so a late writer is always refused.
  yield* sql`
    CREATE TABLE IF NOT EXISTS browser_profile_leases (
      profile_id TEXT PRIMARY KEY REFERENCES projection_browser_profiles(profile_id) ON DELETE CASCADE,
      holder_id TEXT,
      fencing_token INTEGER NOT NULL CHECK (fencing_token >= 0),
      heartbeat_at TEXT,
      expires_at TEXT
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS browser_profile_checks (
      profile_id TEXT PRIMARY KEY REFERENCES projection_browser_profiles(profile_id) ON DELETE CASCADE,
      result TEXT NOT NULL CHECK (result IN ('ok', 'expired', 'unknown')),
      checked_at TEXT NOT NULL,
      expiry_episode INTEGER NOT NULL DEFAULT 0 CHECK (expiry_episode >= 0),
      auto_resign_episode INTEGER CHECK (auto_resign_episode IS NULL OR auto_resign_episode >= 0)
    )
  `;
});
