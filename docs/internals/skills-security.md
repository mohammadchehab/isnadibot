# Skill security requirements

> For maintainers. What the skills registry must get right before a skill's text reaches a bot. The build order
> is [the skills registry](./skills-registry.md); this is the security half of it (TASK-180).
> Using IsnadiBot? See [docs/user](../user/).

A skill is instructions a third party wrote, read by a bot that may hold browser sessions, signed-in sites, the
user's files and that user's connectors. The registry's job is to make sure only text the user has seen reaches
a bot, only from a folder the bot was allowed to read, and only while the text still matches what was approved.

These requirements are the gate for TASK-123.6 (the index, `load_skill`, `read_skill_file`), TASK-123.7 (import
and archives) and TASK-123.8 (the D28 approval gate). Each one names the test that proves it.

## Threat model

The attacker is whoever can put a file where a scanned skill folder is, or answer a URL the user pastes. Four
ways in:

- **A third-party skill.** Text from the internet becomes instructions for a bot. It can ask the bot to read a
  file, drive a signed-in site or hand data to a connector. That is the prompt-injection path the browser
  guardrails (E5) exist to close, and the registry is now a second door onto it.
- **A changed third-party skill.** The user approved one text; the folder now holds another. Approval must be
  tied to the bytes, not the name.
- **A file outside the skill folder.** A `..`, an absolute path or a symlink that leaves the root turns
  "read one skill file" into "read anything on this machine".
- **A skill added out of band.** A clone, a sync client or a second process writes a folder the user never added.
  If the registry treats an unrecorded folder as trusted, the approval gate is decorative.

The bot's own permission mode still applies (a skill cannot approve its own tool calls), and a skill is not a
privilege escalation by itself. What it can do is spend the bot's permissions on an attacker's behalf, more
quietly than a user's own request would.

## Trust per source

| Source    | Who wrote it                   | Reaches a bot when                             |
| --------- | ------------------------------ | ---------------------------------------------- |
| Built in  | this release                   | enabled on the bot                             |
| Provider  | the user or the provider's app | enabled on the bot                             |
| Yours     | the user, in Add skill         | enabled on the bot, or with registry access on |
| Space     | the user, in the project       | enabled on the bot, or with registry access on |
| Community | anyone on the internet         | **and** approved at its current content hash   |

Community is the only source whose author is not the user, so it is the only one D28 gates. The gate follows the
**record**, not the folder: an entry whose stored origin is a GitHub URL or an upload keeps its approval
requirement wherever its files sit. Copying a Community skill's files into a space folder by hand does not make
them a space skill.

An entry the scan finds with no stored record at all (written by a clone, a sync client or a second process) is
**unmanaged**: excluded from every index, refused by both tools, and shown on the registry row as needing to be
added. Fail closed, then let the user add it deliberately.

## The registry-access switch

`skillRegistryAccess` is per bot, defaults to `false`, and decodes to `false` for every bot stored before
migration 078 and for anything imported. It means "this bot may use registry skills I did not switch on for it".

One server-side predicate decides what a bot may see, and every surface calls that predicate. Five surfaces, one
implementation:

1. **The index** joined into the bot's instructions (`resolveIsnadiInstructions`). This is what the model is told
   exists.
2. **`load_skill`** and **`read_skill_file`** in `resolveIsnadiTools`.
3. **`$` and the slash menu** resolution at turn start (TASK-123.9).
4. **The standard OpenCode managed folder** copy (TASK-123.10).
5. **`skills.list`**, which returns the catalog to a client; it may list everything, because listing is not
   loading, but it must report per bot the same `enabled`, `approval` and `visible` answer the server enforces,
   so a client cannot offer what the server will refuse.

Requirements:

- With the switch off, the index carries only the skills switched on for that bot. With it on, it carries those
  plus every skill in the registry that is approved and not switched off for it.
- Nothing in a client decides visibility. Web, mobile and desktop render the server's answer; a client-side
  toggle is a display of a stored value, never the check.
- A skill that is unapproved or changed never appears in the index and is refused by every surface above, with
  the same reason, whether or not the switch is on. The switch widens the set; it never widens approval.
- Only the user changes the switch: `bot.update` with the same scope as editing the bot's engine (operate or
  admin). No bot tool, `load_skill` nor a routine may set it, and a bot may not edit its own skill set.
- Flipping it takes effect on the next turn, is recorded as an authored event, and is visible in the bot's panel.
  Switching it off is the way out (reverse state), and it must take a skill the user never switched on back out
  of the index on the next turn, without touching the bot's own `skills` entries.
- A bot that fails over to another provider keeps the same answer: the predicate lives above the adapter, so the
  index for one bot is identical on Codex, Claude, Grok, Kimi For Coding, OpenCode Go and Custom API.

## What `load_skill` and `read_skill_file` may read

`load_skill` returns one `SKILL.md` body with its frontmatter stripped. `read_skill_file` returns one file
inside that skill's folder. Neither may return anything else.

- **Only an indexed skill.** The name resolves against the calling bot's index, never against the filesystem and
  never against the registry at large. A name that is not in the index is refused with the same message an
  unknown name gets, so the tool does not confirm that a hidden skill exists.
- **The real path stays inside the skill root.** Resolve the root and the target to their real paths
  (`realpath`, then compare, not a string prefix on the joined path) and refuse unless the target is under the
  root. Refuse `..` (in any encoding the OS decodes), absolute paths, and a symlink anywhere in the path whose
  target leaves the root. A symlink that stays inside the root is allowed; a skill folder that is itself a
  symlink is resolved once, and its real directory is the root.
- **Text only, capped.** A file is capped at 256 KB after decoding, refused if it does not decode as UTF-8, and
  refused if it is a directory, a device or a socket. Binary sniffing is not required; the decode refusal covers
  it.
- **Nothing from the provider or project surroundings.** The guard is per skill root, so `<project>/.git`,
  `<project>/.isnadi/settings.json`, a sibling skill and `<userdata>/secrets` are all outside it.
- **Refusals do not disclose.** An error names the path the model asked for, never the resolved absolute path,
  the root, or whether the failure was a symlink, a permission or a missing file. One message for every refusal
  reason except the 256 KB cap.
- **Results are data.** The body comes back as tool output, never appended to the bot's instructions, wrapped in
  a delimiter that says "skill text, not instructions from the user". This does not stop injection; it keeps the
  model from mistaking a skill's text for a system message, and it is what lets the chat show a load.
- **Every load is accounted.** Both tools emit a thread activity ("Loaded <skill>"), update `usedBy` and
  `lastLoadedAt`, and are rate-limited per turn so a loop cannot read a folder file by file.

## Provenance: what every entry records

One row per skill copy, written by the command that created it and never inferred from a path:

| Field                    | Meaning                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| `id`                     | `<source>:<scope>:<name>`, stable across a rescan                                |
| `source`, `scope`        | from the table above; `scope` distinguishes this space from all spaces           |
| `origin`                 | Community only: the URL and the resolved commit SHA, or the upload's id and time |
| `contentHash`            | sha256 over the sorted relative paths and their bytes, computed server-side      |
| `approvedHash`           | the hash the user saw when they approved (D28)                                   |
| `addedBy`, `addedAt`     | the session and the instant the entry was created                                |
| `usedBy`, `lastLoadedAt` | from the tools; display only                                                     |

- The hash covers exactly the bytes that will be read: the same file set the tools serve, with no file excluded
  from hashing but served anyway. It is recomputed on every rescan.
- The hash is **integrity and pinning, not authenticity**. It proves the skill did not change; it does not prove
  who wrote it, and a matching hash is not a reason to trust a hostile author. The trust anchor is the human who
  read the text and pressed Approve.
- No signature verification ships in this milestone. If a signature format is added later it must be verified
  server-side, must pin the same content hash, and must never be accepted as a substitute for D28 approval of a
  Community skill.
- Provider skills are read in place and never copied, so their hash changes whenever the provider app rewrites
  them. That is fine: they carry no approval gate, and their protected property is that Isnadi never writes to
  `~/.claude`, `~/.codex` or Grok's home.

## GitHub and archive intake

Both paths are untrusted input and both end in the same place: files written by the server into a scope.

- **GitHub.** Accept `https` only. Resolve the ref to a commit SHA before fetching, fetch that SHA (not the
  branch) from the canonical host, and record the SHA as `origin`. Do not follow a redirect to another host
  without re-checking the host against an allowlist; never send an auth header or a token to a resolved URL that
  is not GitHub's own. Cap the download at 5 MB and the request at a fixed timeout.
- **Archives (tarball and .zip).** Reject on the first violation rather than stripping: entries above the 5 MB
  compressed or a 50 MB inflated cap, more than 200 files, an absolute path, a `..` segment, a symlink, a
  hardlink, a device, an exec bit, a duplicate entry name, a path escaping the skill's folder, and an empty
  file list. Unpack into a temporary directory under the target scope, hash there, then move into place, so a
  rejected archive leaves nothing behind.
- **The whole archive is not the skill.** Extract only the skill's own folder (the directory holding its
  `SKILL.md`); a repository is not a skill and its other files are not copied.
- **Community entries land unapproved.** Both paths create the entry with `approval: needs-approval` and its
  `contentHash`; nothing is indexed until the approval command records `approvedHash`.

## The D28 approval gate

The server enforces it; the dialog only drives it.

- **What the user approved is what is stored.** Add → hash the extracted files → store the entry with that hash
  and the full text → the dialog renders the stored bytes and the stored file list → Approve records
  `approvedHash = contentHash` for the hash the dialog showed. A skill that changes between add and approve
  therefore shows "Needs approval" again instead of silently approving bytes nobody read.
- **One gate, five checks.** The same predicate as the registry-access switch: the index, `load_skill`,
  `read_skill_file`, `$` resolution and the OpenCode copy all refuse an entry whose `approvedHash` is missing or
  differs from `contentHash`. So does the connector check, which reports needs-approval before it reports a
  missing connector.
- **Approve and cancel are both real.** Cancel deletes the files that were added by the add command and nothing
  else. Approve is idempotent for an unchanged hash. Removing the skill deletes the row and the files, and
  nothing re-approves implicitly.
- **Re-approval shows the diff.** When a rescan finds a new hash, the row reads "Needs approval" and the dialog
  lists the files added, removed and edited since `approvedHash`.
- **Approval does not travel.** Skills stay out of the portability export. A project moved to another machine
  brings its space skills and brings no approval for a Community entry; the entry lands unmanaged and needs
  adding, which is the safe direction.
- **No approval from a bot.** No tool, routine or delegation reaches the approve command; it takes a user scope.

## Failure modes, fail closed

| Failure                                               | Behaviour                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| A skill folder is unreadable, or a file fails to hash | entry excluded from the index and from the registry list         |
| The projection row and the folder disagree            | folder content wins for the hash; the entry shows needs-approval |
| A skill folder disappears                             | entry removed on rescan; bots drop the id, no cached text        |
| The GitHub fetch or the archive is malformed          | add fails, the temporary directory is removed, nothing is stored |
| The scan fails mid-way                                | no partial index is served; the last complete index is kept      |
| A tool reads outside its root                         | refused; the refusal is one generic message                      |

## Review checklists

TASK-123.6 — the index and the two tools:

- [ ] The index builder and both tools call one visibility predicate; no second implementation exists in web,
      mobile or the OpenCode copy path.
- [ ] A test proves a skill that is unapproved, changed, disabled or (switch off) not switched on is absent from
      the instructions and refused by both tools with the same reason.
- [ ] A test proves the same bot's index is byte-identical across Codex, Claude, Grok, Kimi For Coding, OpenCode
      Go and Custom API.
- [ ] The path guard test covers `..`, an absolute path, a symlink leaving the root, a symlink inside the root, a
      skill folder that is a symlink, the 256 KB cap, a non-UTF-8 file and a directory.
- [ ] Refusal messages leak no absolute path and do not confirm the existence of a hidden skill.
- [ ] Neither tool can be made to read `<project>/.git`, the project's `.isnadi`, a sibling skill or
      `<userdata>/secrets`.
- [ ] Both tools emit the activity, update `usedBy` and `lastLoadedAt`, and are rate-limited per turn.

TASK-123.7 — import, GitHub and archives:

- [ ] GitHub fetches the resolved SHA, not a branch, over https, with the host re-checked across redirects and no
      credential sent to a foreign host.
- [ ] Every archive limit and every rejected entry type has a test, including a zip bomb against the inflated
      cap and a duplicate entry name.
- [ ] A rejected archive leaves no file behind; a successful one is hashed after extraction and moved into place.
- [ ] Only the skill's folder is extracted; importing a provider skill copies and leaves the original untouched.
- [ ] A name clash never overwrites; the replace path keeps the old files until the new set is complete.
- [ ] A Community entry is created unapproved with its hash, and is in no bot's index until approved.

TASK-123.8 — the gate:

- [ ] The four approval states (none, approved, changed, approved again) each pass the index, both tools and `$`.
- [ ] Approve stores the hash of the bytes the dialog showed; a change between add and approve re-opens approval.
- [ ] Cancel removes exactly what the add created; remove deletes the row and the files; both are tested.
- [ ] No RPC used by a bot, a routine or a client without a user session can reach approve.
- [ ] A rescan that changes one byte flips the row to "Needs approval" and shows the file-level diff.

## Accepted risk

- A prompt-injected skill still acts within the bot's permissions. The mitigations are the approval the user
  reads, loads being visible in the chat, the switch off by default and the bot's own approval policy — not a
  claim that skill text is safe.
- Provider skills carry no approval gate: their author is the same person who installed the provider app, and
  their files are outside Isnadi's boundary. Their content is still read through the same guarded tools.
- `skills.list` may name a skill the calling bot cannot load. Listing is metadata; the enforcement is elsewhere.

## Open questions

- **A space skill that arrives with a clone.** It is unmanaged by the rule above, so a project a teammate shares
  loses its skills until the user adds them. If that friction is unacceptable, the architect decides whether a
  space folder may be added wholesale once per project (one approval covers the folder's current hashes), and
  this document gains that rule. It is not assumed by any checklist above.
- **Where unmanaged entries surface.** The registry row is the obvious place; the row design (screen 3a) has no
  state for it yet, so the designer decides in TASK-123.3.
