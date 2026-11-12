# Egress transport

A server-side browser can reach the network only through the user's desktop. The desktop resolves and pins the address; the server never dials.

## Routes

- `GET /egress` is the control WebSocket. One per desktop. It carries `open` frames down and `refused` / `closed` frames up (`packages/contracts/src/egress.ts`).
- `GET /egress/stream/:streamId?ticket=` is one WebSocket per CONNECT stream, carrying raw bytes.

Both require a session whose scopes are exactly `[egress:provide]`. It is granted only by the separate `egress-provider` grant, whose token the desktop main process keeps (`bootstrap.egressProviderToken`) and never gives to a renderer or any other credential. The desktop exchanges that token asking for `egress:provide` alone.

## Server: `EgressBroker`

`open` fails closed with `ProviderGone` when no control socket is registered or when it drops mid-stream. Each `open` mints a stream id and a ticket: single-use, ten seconds, bound to (owner, stream id). The server's host, port, and profile are advisory.

## Rules for the first `open` caller

`EgressBroker.open` has no caller yet; TASK-41's loopback proxy is the first. The broker, its two routes and the desktop checks below them were reviewed on 2026-11-12 against these rules. They are security requirements for that caller, not tuning, and the review of its PR checks them one by one.

- **The owner comes from the session, never from a request.** `/egress` and `/egress/stream` take the owner from `session.subject` and require scopes exactly `[egress:provide]`. Today `open` takes the owner as an argument, so nothing in the type stops a consumer from passing a value that came from a client frame, a bot or a page: the caller must take it from the same session, and TASK-192 closes the opening in the signature itself.
- **No direct dial path.** A destination reaches the broker and nothing else. The consumer never resolves, dials, or falls back to the network when the broker is down; `ProviderGone` is the answer, and it is the fail-closed state the interface shows.
- **Host, port and profile stay advisory.** The server enforces no grant and keeps no "checked" state: the desktop re-checks the profile binding, the port (80 or 443), the granted host and the address class on every open, before any DNS or TCP. A caller that assumes the server already checked is the bug.
- **The consumer bounds its own concurrency.** The 64-stream and 5 MiB/s limits are desktop-side, so they refuse at the far end; the broker does not cap streams per owner (TASK-192). A consumer that opens a stream per navigation caps per owner and profile itself.
- **The listener is loopback, with per-session credentials.** `127.0.0.1` only, never `0.0.0.0` or `::`, and a connection without valid credentials is refused before any destination is parsed.
- **Logs carry host, port and decision only.** Never a URL, path, query or header. The ticket rides in the stream route's query string and is kept out of traces (`egressTicketRedactionLayer`); nothing logs a request line.

## Desktop: `EgressProvider`

Every `open` goes through `openEgressTarget` (`EgressDialer`), so a blocked address is refused before any TCP. Limits: 64 streams per session, five minutes idle, 5 MiB/s token bucket (`EgressLimits`).

## Desktop: `DesktopEgress`

`forkDesktopEgress` (started from `DesktopApp.bootstrap`) exchanges the egress provider token for an `[egress:provide]` bearer, opens the `/egress` control socket, and serves `open` frames with `makeEgressProvider`. It dials with `dns.lookup` (all addresses, verbatim) and `node:net`, reads the PC's interface CIDRs fresh on every open, and opens `/egress/stream/:id?ticket=` for each stream. When the control socket closes it destroys every live stream, then reconnects with a 1s, 5s, 30s backoff (reset after a connection that held for a minute). The WSL backend has no egress token and does not provide egress.

### Egress grants

The host policy is `DesktopEgressGrants.policyFor(PRIMARY_INSTANCE_ID)` (`EgressGrantStore.ts`). The server's `profileId` is never trusted alone: the desktop keeps a binding from its own backend instance id to the profile ids that backend may serve, and a profile outside that binding is refused with `host-not-granted` before any DNS or TCP.

The binding key is the desktop's own saved-environment record — the one the user paired with and whose bearer token the desktop holds — never `httpBaseUrl` and never anything the server sends. A URL is not an identity: it changes with tunnels and Tailscale names, and a different server reached at a reused URL would inherit the old binding. The reverse state comes with the key: removing or unpairing an environment deletes its binding, so a re-paired environment starts with nothing bound. Grants stay, because a profile is not owned by one environment; a newly paired environment therefore shows the profile's remaining grants, and the grant UI must not present them as if they were created for it.

Grants live per profile in `egress-grants.json` in the desktop state directory (mode 0600 in a 0700 directory). A write goes to a temporary file at mode 0600, is fsynced, and is only then renamed over the store, one write at a time. An fsync or rename that fails leaves both the file on disk and the in-memory snapshot on the previous grants; a write that never reaches the rename is never observable.

A grant is an exact host or a wildcard. Hosts are normalized (case, trailing dot, numeric IPv4 spellings, brackets); a host that does not parse is refused. A wildcard for `example.com` allows `example.com` itself and every subdomain, on a label boundary only (`evil-example.com` and `example.com.evil.com` do not match), and never matches an IP literal. A wildcard on a public suffix, a single label or an IP-shaped value is refused when it is saved. Private suffixes count as suffixes: `*.github.io` and `*.blogspot.com` are refused, because one grant there would cover every unrelated site hosted on them, while the exact host `foo.github.io` is accepted. A grant is not an address allowlist: a granted name that resolves to a private, loopback, link-local, metadata or interface-subnet address is still blocked.

Only a missing file is an empty store. A file that fails to decode, or that exists but cannot be read at all, means deny everything (`status` is `unreadable`): a file the desktop cannot see might hold grants, so it is never treated as empty and never rewritten implicitly. Writes are refused until `reset()` replaces it. Every stored grant is re-checked against the current rules when the file is loaded, and one they now refuse is dropped: it cannot be dialed, and the next successful write leaves it out of the file. Because the snapshot is what `revoke` searches, removing such a grant is a no-op rather than an error; a revoke control rendered per stored grant must read the file, not the snapshot. `revoke` itself only normalizes and never validates, so it can name a grant the entry check would refuse. Revoking a grant, changing a binding or resetting publishes a revocation; the provider re-evaluates its live streams of that profile and ends the ones that are no longer allowed, including a dial still in flight. The runner seals the store's subscription before it forks the provider, so a revocation published while no stream is watching is still delivered rather than lost. The owner's grant, list and revoke interface is a follow-up.

Grants are the only permission a signed-in site carries over the network, so the rules above are security requirements, not tuning: see [site sign-in security](./site-signin-security.md).
