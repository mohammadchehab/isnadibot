## @isnadi/web@0.0.41

## 0.1.0

### Minor Changes

- [#350](https://github.com/mohammadchehab/isnadibot/pull/350) [`f81c1b6`](https://github.com/mohammadchehab/isnadibot/commit/f81c1b6d78391ebb1800de7db4a7a59df5df12ea) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - The Decisions page now reads as one list sized to the design's column: each row shows who is waiting, whether it is an approval or a question, and the chat it waits in, and clicking a row opens exactly that chat. Before any environment had answered, the page claimed nothing was waiting; it now shows a still placeholder instead, and an empty queue explains what will appear there. On a phone the list runs full width with a 16px gutter.

- [#318](https://github.com/mohammadchehab/isnadibot/pull/318) [`b5880a1`](https://github.com/mohammadchehab/isnadibot/commit/b5880a1cf0d525b427541a41603ce59111223285) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A space a bot made now says so. The space header shows **Made by** and the bot's name just after the space name, on every tab, so you can tell a space a bot set up apart from one you made. If that bot has since been removed, the label reads "Made by a bot" instead, and a space you made yourself shows nothing.

- [#354](https://github.com/mohammadchehab/isnadibot/pull/354) [`b962b2c`](https://github.com/mohammadchehab/isnadibot/commit/b962b2cb7ecc12f4b1f9fec4fe398fa403f0355e) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Adding a bot to a space now opens the role library instead of the space's details: pick a role, and the bot is created with that role's avatar, skills and default model already set, in the space you were looking at. The list is the same role library squad setup hires from, so a role you can hire is a role you can pick.

- [#326](https://github.com/mohammadchehab/isnadibot/pull/326) [`46c2cae`](https://github.com/mohammadchehab/isnadibot/commit/46c2caefeb4045dc8d021ca9db329d464101c46e) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A space has a settings page. Open it from the space's header menu or from the row at the foot of its details panel, and it shows the space's name, how many bots it has and who leads it, with the two settings a space has today: **Boss** and **Keep everyone busy**.

  Those two used to live only in the details panel, where the boss select was easy to miss and the switch sat among the roster. They now have a page of their own, with a line under each one saying why it cannot be used yet — no bots, only one bot, or no boss chosen — instead of a control that silently does nothing. The panel keeps the roster and links to the page, so each setting has one control in one place.

- [#348](https://github.com/mohammadchehab/isnadibot/pull/348) [`f992b78`](https://github.com/mohammadchehab/isnadibot/commit/f992b78697006ab0f56d541be5a1d84970fbbc71) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Inside a space, the command palette now has a team group headed with the space's name: steer a bot that is working, interrupt it, or add a bot to the space without leaving the palette. Bots that are idle are not listed, because there is nothing to steer or interrupt until they start.

- [#366](https://github.com/mohammadchehab/isnadibot/pull/366) [`7452116`](https://github.com/mohammadchehab/isnadibot/commit/745211678bd2b8f2a2663dfb18f8203a814dfd9b) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Each row on a space's Team table now has an actions menu. A bot that is working offers Steer, which sends a correction into the turn it is running, and Interrupt now, which ends that turn. A bot that is not the boss also offers Archive, which asks for confirmation first and says why when the space refuses.

- [#340](https://github.com/mohammadchehab/isnadibot/pull/340) [`a74e697`](https://github.com/mohammadchehab/isnadibot/commit/a74e6970845d26fc15f199996a52cfc404b18bd1) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Every plugin in the directory is listed and connectable. The Plugins screen used to show only the
  three integrations that had a public integrations.sh listing, so 51 of 54 entries were invisible, and
  **Connect** stayed disabled on the 38 entries marked **Verification pending** even though connecting is
  what verifies them. All entries that have not been retired now appear, and an unverified entry connects
  and starts its vendor sign-in. A plugin whose publisher has not approved access keeps its blocker and
  stays disabled.

- [#361](https://github.com/mohammadchehab/isnadibot/pull/361) [`c12f898`](https://github.com/mohammadchehab/isnadibot/commit/c12f89825568f514e0b88247c53f6e3e6df25f4e) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Adding a skill and approving a Community one now have their own dialogs. **Add a skill** offers the three ways in — a provider's skill, a GitHub link, a `.zip` — in one dialog, and asks where it belongs: this space, or every space. A link that names no skill folder, or an archive that is too big or is not a zip, says so in the dialog before anything is sent. A Community skill then opens the approval dialog, which shows where the skill came from, what the bot will be told, and the files it brings, so nothing reaches a bot before you have read it.

- [#332](https://github.com/mohammadchehab/isnadibot/pull/332) [`53270c7`](https://github.com/mohammadchehab/isnadibot/commit/53270c7552d7a30ec7eb263f415b716966258b8a) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Usage opens on cost, and a window nobody priced no longer reads as free.

  The page used to open on turns; it now opens on dollars, so the first thing a user sees is what their work cost rather than how much of it there was. Tokens are still one click away.

  A window where no provider reports a price used to print **$0.00**, which says "this cost nothing" when the truth is "nobody knows". The headline now shows an em dash and says so in words, and the per-provider, per-model and by-time dollar cells follow the headline instead of contradicting it one row down. Cache savings keeps its own figure, because it is a different claim.

### Patch Changes

- [#324](https://github.com/mohammadchehab/isnadibot/pull/324) [`636f40e`](https://github.com/mohammadchehab/isnadibot/commit/636f40eeb2651789bff087d182bd94c020bd6fba) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A bot that hits an unexpected internal error no longer sends that error's text to your other devices. When the server fails in a way it did not plan for, every paired client now receives a plain "Internal server error" instead of the raw message, which could carry file paths or other private details. Failures the app reports on purpose are unchanged.

- [#314](https://github.com/mohammadchehab/isnadibot/pull/314) [`8118b7b`](https://github.com/mohammadchehab/isnadibot/commit/8118b7b0297ff8091d2436f073e5f96a18fdb054) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A command that fails now sends its reason once. A server error used to carry the same sentence twice — including a host, port or folder path — which made the message harder to read and put the details on the wire twice.

- [#345](https://github.com/mohammadchehab/isnadibot/pull/345) [`3c33f90`](https://github.com/mohammadchehab/isnadibot/commit/3c33f900179a47768113118f60a595ee9e8b0ce1) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A group chat now says what the board is doing. When a bot is idle and the board hands it an item, the chat says which bot and which item; when everyone is idle and nothing is waiting, it says that too. Before, a group that was working through its queue and a group that had run out of work looked exactly the same.

- [#352](https://github.com/mohammadchehab/isnadibot/pull/352) [`4992c39`](https://github.com/mohammadchehab/isnadibot/commit/4992c39a48effdf545f6859095d1b02eb818dbe0) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A held row on the Team table now says what it is waiting on and offers Resume. When a bot's card is blocked, the row shows the reason the block recorded, and Resume hands the card back so the bot can pick it up again.

- [#356](https://github.com/mohammadchehab/isnadibot/pull/356) [`0f18170`](https://github.com/mohammadchehab/isnadibot/commit/0f18170a3f3f6abd235bc2a9efbee76d80238aaa) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A routine's finished row in the chat now says when the run happened, in the row's own words: "The standup routine ran at 9:00 AM." A run that left a summary keeps it after the sentence. Runs that are still going, canceled or failed read exactly as before.

- [#283](https://github.com/mohammadchehab/isnadibot/pull/283) [`859548f`](https://github.com/mohammadchehab/isnadibot/commit/859548fd39e0959fb665020b9808e45473e8a4ac) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A space that still holds open work now calls it a space in every language, instead of showing the internal word "group".

- [#349](https://github.com/mohammadchehab/isnadibot/pull/349) [`7dfb6e5`](https://github.com/mohammadchehab/isnadibot/commit/7dfb6e5cd13a2e47a5af3bde6c8f44fcaf5727ee) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A space's Overview now shows the whole space in one place. A Tasks tile reports how many items are open, how many are in progress and how many finished this week. Below the tiles, a Team table gives every member a row with what it is doing, the item it is on and how full its context is, and the space's kanban board sits on the page itself instead of behind a second screen.

- [#357](https://github.com/mohammadchehab/isnadibot/pull/357) [`4c8c613`](https://github.com/mohammadchehab/isnadibot/commit/4c8c61355688302728d568c54fa13f92c3264fcc) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A space's Tasks board now draws its columns the way the design frames them: 156 wide with a border on the card surface, 8 apart, a plain count beside each column's name instead of a badge, and card titles and details at 12 and 11. Before, the page's columns were 256 wide with no border, and the count sat in a badge.

- [#360](https://github.com/mohammadchehab/isnadibot/pull/360) [`e9cc491`](https://github.com/mohammadchehab/isnadibot/commit/e9cc4912b386bd2c8fc44a228f1bc66c972d5aa4) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A space's Team table now draws each bot's avatar beside its name, and its rows and header sit at the height they were drawn at.

  The Bot cell used to be the name and, for the boss, a badge. It now leads with the bot's 20px avatar, so a row reads as the bot rather than as a word. Rows grew from about 37px to the frame's 53, and the header row from about 20 to its 40, which gives the table the air the Overview screen was designed with.

- [#237](https://github.com/mohammadchehab/isnadibot/pull/237) [`2b52f63`](https://github.com/mohammadchehab/isnadibot/commit/2b52f635031ed9270f64ebdf10454ae9b9d97808) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Working in a space you are not a member of now says so in your own language, instead of showing the server's internal wording with a raw person id and group id.

- [#358](https://github.com/mohammadchehab/isnadibot/pull/358) [`20c39f8`](https://github.com/mohammadchehab/isnadibot/commit/20c39f8c6018a4e5b9fff93e993081c1c4fe9d3e) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A space's Activity tile now reads as a list of what actually happened. Each delegated piece of work gets one row that says the bot's name, what happened in plain words, and the state it ended in, and a row that is waiting on you lifts off the tile with a Review action instead of hiding behind a bare "blocked".

- [#347](https://github.com/mohammadchehab/isnadibot/pull/347) [`4eaa084`](https://github.com/mohammadchehab/isnadibot/commit/4eaa084ad6ee9f4c00abd39b7a32745190598d92) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - An item can name the role that should take it, and the board no longer hands it to whoever happens to be free. If nobody in the space holds that role, the item waits instead of going to the wrong bot, and the chat says so in a row that names the missing role. Once a member with that role is in the space, the item moves on its own, without restarting anything. Items that name no role are handed out exactly as before.

- [#241](https://github.com/mohammadchehab/isnadibot/pull/241) [`5ff9bd8`](https://github.com/mohammadchehab/isnadibot/commit/5ff9bd84e7d954922a580434c8f406f7479165c2) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Archiving a bot that leads a space now says why in your own language, instead of showing the server's internal sentence with a raw bot id and group id.

- [#244](https://github.com/mohammadchehab/isnadibot/pull/244) [`1aea3bf`](https://github.com/mohammadchehab/isnadibot/commit/1aea3bf928966c04c47464b8be260a419b917746) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Creating a space no longer moves a bot out of the space it already belongs to. The
  new-space dialog leaves out bots that already have a home, and the server refuses the
  create with a plain sentence telling you to create the space without the bot and add it
  afterwards.

- [#299](https://github.com/mohammadchehab/isnadibot/pull/299) [`b1ee278`](https://github.com/mohammadchehab/isnadibot/commit/b1ee278d98b01affa40fd94f0075d1a8c89cde54) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Leaving bot settings right after a save no longer asks "Discard unsaved bot settings?". The page now remembers what it last saved, so a save that has not reached the screen yet still counts as saved, while a real change made after it still asks before it is dropped.

- [#305](https://github.com/mohammadchehab/isnadibot/pull/305) [`c83a951`](https://github.com/mohammadchehab/isnadibot/commit/c83a9511e78a0f3fe251e196c4c1e4ccf4f455fd) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A bot turn that dies no longer leaves its work item assigned forever. The item goes back in the queue after one short wait, and a second failure in a row blocks it with the reason on the card, so the bot stops reading as busy and the work behind it moves again.

- [#250](https://github.com/mohammadchehab/isnadibot/pull/250) [`e1b8b40`](https://github.com/mohammadchehab/isnadibot/commit/e1b8b40e0e729c754a060fbd72ee241dad0391c0) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Approvals a bot raises while doing delegated work can now be answered from the work card in the chat that asked for it. Before, the child chat was only reachable read-only, so the approval could not be answered anywhere and the work stalled.

- [#321](https://github.com/mohammadchehab/isnadibot/pull/321) [`156304e`](https://github.com/mohammadchehab/isnadibot/commit/156304e4e2f511ed3b736f11b25e96fc37f8a1d7) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - The process diagnostics INT and KILL actions and the composer's send button now use the design system's declared button looks, so every disabled control fades to the same 64 percent instead of one of six hand-written weights.

- [#246](https://github.com/mohammadchehab/isnadibot/pull/246) [`36cf924`](https://github.com/mohammadchehab/isnadibot/commit/36cf924d66960dcd04822d7149e0b31132d300a9) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - The dictation control in the message box is now a real Button, so it takes its solid circle and its disabled look from the design system instead of writing them out by hand. Sidebar rows and their sub-rows also take their disabled look from the one place the sidebar menu declares it, which keeps a disabled label and icon at the muted ink the design draws.

- [#238](https://github.com/mohammadchehab/isnadibot/pull/238) [`b3ba067`](https://github.com/mohammadchehab/isnadibot/commit/b3ba0672faa11634d0435a23f52b92b9c9dc7922) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Adding or removing a bot in a space now says why the change was refused — the space already has a boss, the bot is no longer in the space, the bot leads the space, or the space would be left with fewer than two bots — instead of showing only a generic error title.

- [#243](https://github.com/mohammadchehab/isnadibot/pull/243) [`e31083a`](https://github.com/mohammadchehab/isnadibot/commit/e31083a1d5fca0a4133d69802b48a3dc7fd10ddf) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Adding or removing a bot in a space no longer shows the server's internal wording with a raw group or bot id when the space or the bot has been deleted on another device. Those refusals keep the plain title, and every refusal the server can explain still says why in your own language.

- [#336](https://github.com/mohammadchehab/isnadibot/pull/336) [`1ff9709`](https://github.com/mohammadchehab/isnadibot/commit/1ff97095ec9131f0032ef1272d41c8cf45a4ce5f) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A failed memory edit no longer shows the server's raw reason, so a missing file can no longer put an absolute path and your computer's username on screen. The memory panel on web and mobile now shows its own sentence, and recognises a fact that changed elsewhere from the error's typed reason instead of from the failure text.

- [#287](https://github.com/mohammadchehab/isnadibot/pull/287) [`57601f9`](https://github.com/mohammadchehab/isnadibot/commit/57601f9f6a4c07a4a94c53f56a5c5a1c9652f08e) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A memory request that fails now says what went wrong in plain words instead of showing a raw filesystem path or saying nothing at all. A save that hits a changed memory or a changed bot tells you to reopen memory before saving.

- [#333](https://github.com/mohammadchehab/isnadibot/pull/333) [`b911f46`](https://github.com/mohammadchehab/isnadibot/commit/b911f46d32ed5ffadb8cc99e27b7e256310cf728) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A memory save that loses to a change made somewhere else now tells you to reopen memory before saving, in plain words, instead of a generic failure. The server reports the conflict as a named condition rather than leaving every client to recognise it from the failure text.

- [#317](https://github.com/mohammadchehab/isnadibot/pull/317) [`73d1861`](https://github.com/mohammadchehab/isnadibot/commit/73d1861ab3ce5bb8fb0e3a541b61e08fc087c961) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - The space overview, standup and decisions lists sort through a copy-and-sort again, so the shared code no longer depends on an array method the mobile app's runtime does not provide.

- [#245](https://github.com/mohammadchehab/isnadibot/pull/245) [`371c1d5`](https://github.com/mohammadchehab/isnadibot/commit/371c1d5d9757c4bb1b73de9c78f2d1ae397b93e5) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Acting on a project, bot, delegation, MCP server, group or chat that another device already changed now says what happened in your own language, instead of showing the server's internal wording with a raw id. Refreshing, unarchiving, or picking a different folder is named in the message.

- [#338](https://github.com/mohammadchehab/isnadibot/pull/338) [`29e2fa8`](https://github.com/mohammadchehab/isnadibot/commit/29e2fa8cd31cbb593d3a2827cb4be1bb76d1cf41) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A bot's delegate can now be answered when it asks for approval. A bot may hand work to another bot, and that bot may hand work on once more; the second hand-off used to raise its approval on a card you could never reach, so the work waited forever. That approval now appears on the card one level up, labelled with the bot that is asking, and answering it there unblocks the work.

- [#255](https://github.com/mohammadchehab/isnadibot/pull/255) [`8a0eab5`](https://github.com/mohammadchehab/isnadibot/commit/8a0eab5fcdf1891662d5e5be71f54c8e2b3affc5) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Creating a space now says why it failed when the server refuses it, in plain words. A paired client without permission to change the environment is told before it presses Create, instead of pressing a button that can never work.

- [#323](https://github.com/mohammadchehab/isnadibot/pull/323) [`dd68d3a`](https://github.com/mohammadchehab/isnadibot/commit/dd68d3a0b0403311343de24d266be1a8d4ab0c1a) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A provider whose API key was revoked upstream now counts as unable to run a bot, the same as a revoked sign-in, so hiring a team reports the reconnect instead of creating bots whose every turn the server refuses. A provider instance that carries its own saved login is now judged by that login instead of passing through unchecked.

- [#313](https://github.com/mohammadchehab/isnadibot/pull/313) [`9c1a529`](https://github.com/mohammadchehab/isnadibot/commit/9c1a5291a8771e65609127de2cdb0e8cd996cb2d) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A provider whose saved sign-in was revoked no longer counts as able to run a bot, so hiring a team says which provider to reconnect instead of creating bots that fail their first turn.

- [#247](https://github.com/mohammadchehab/isnadibot/pull/247) [`ff3b454`](https://github.com/mohammadchehab/isnadibot/commit/ff3b454ae3f94128537593cc948141500894e5a8) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Deleting or archiving a bot you do not have access to now says so in plain words, instead of showing the server's internal sentence with a raw person id and a group id. Web and mobile now share one table of refusal copy, so a refusal no screen was written for still reads correctly.

- [#274](https://github.com/mohammadchehab/isnadibot/pull/274) [`fb73aa7`](https://github.com/mohammadchehab/isnadibot/commit/fb73aa759429998d1f20ae2addd2908ee7d5c807) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A failure while saving settings, opening an editor, or signing in to a provider now says what went wrong in plain words, instead of printing a file path, a provider instance id, or an environment variable name on screen. Those details stay in the log.

  Settings failures also say what failed again: reading the settings, saving them, storing or removing an API key, or rejecting invalid sandbox values each get their own sentence, rather than one line covering all of them.

- [#346](https://github.com/mohammadchehab/isnadibot/pull/346) [`9674706`](https://github.com/mohammadchehab/isnadibot/commit/967470692cbdb1251d6395cb5128d7b02781abbd) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - The skill registry screens, on dev fixtures. A space's Skills tab and Settings › Skills draw the registry the design calls for: one row per skill with its source, size and last load, the **This space / All skills / Unused** filters, and the three states a row can be in — needs approval, changed since approved, and needs a connector. This is phase 0. It reads a dev fixture, its actions are inert, and a shipped build hides the screen until a real source lands, so this ships as a patch rather than a feature.

- [#257](https://github.com/mohammadchehab/isnadibot/pull/257) [`202daf6`](https://github.com/mohammadchehab/isnadibot/commit/202daf604c42e6aa9c8c122306681cc883a7ec44) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A space's Activity now lists the work its bots did for it, not only the space's own chat. The list was reading the sidebar's top-level chats, which never include a delegation.

- [#297](https://github.com/mohammadchehab/isnadibot/pull/297) [`2f055de`](https://github.com/mohammadchehab/isnadibot/commit/2f055de0f7e7d69a7e1eb5c1420ae5cadfeea502) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A space's Overview no longer claims a publisher. It said "Published by {name}" although nothing publishes a dashboard — the Overview is derived live from the space's own work — so the attribution is gone and the "updated {time}" freshness line stays.

- [#292](https://github.com/mohammadchehab/isnadibot/pull/292) [`9f4b0e8`](https://github.com/mohammadchehab/isnadibot/commit/9f4b0e8b178cd35abe83e6f7b0e3d50fe4bb0640) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Squad setup now draws a hard block — a client that cannot write to this environment, or a squad with no provider to run it — as the warning band under the heading, where it is read before the squad it blocks, instead of a caption beside Create.

- [#302](https://github.com/mohammadchehab/isnadibot/pull/302) [`4fcb589`](https://github.com/mohammadchehab/isnadibot/commit/4fcb589bee4831b67f3a2561440a32b4b19c2588) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Squad setup now offers an Open Settings button when no provider can run the squad you are about to hire, so a fresh install shows the way out instead of a dead end.

- [#256](https://github.com/mohammadchehab/isnadibot/pull/256) [`74213f5`](https://github.com/mohammadchehab/isnadibot/commit/74213f5a81a2fb760a6ef21e36ccb24bc1b90578) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Setting up a squad now titles the screen after the fleet you picked, so software engineering reads "Set up your software engineering squad" instead of the recruiting one.

- [#260](https://github.com/mohammadchehab/isnadibot/pull/260) [`8971c42`](https://github.com/mohammadchehab/isnadibot/commit/8971c42efc5240c4b62828aab7db099cfa4b175c) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A space's standup now names the bot that is actually waiting. A chat a group delegated is charged to the bot answering in it, not to whichever bot happened to be responding in the group.

- [#240](https://github.com/mohammadchehab/isnadibot/pull/240) [`a42f709`](https://github.com/mohammadchehab/isnadibot/commit/a42f709c593bcb65bf58d906bbbd30bf73110fc8) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - Settling, snoozing, pinning, reordering pins, restoring history, resuming a turn and marking channel delivery now say why the server refused, in your own language, instead of showing the server's internal wording with a raw chat id.

- [#353](https://github.com/mohammadchehab/isnadibot/pull/353) [`07fb95a`](https://github.com/mohammadchehab/isnadibot/commit/07fb95a14a9b53912eb84b83a41a637911f32a55) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - The Usage page now looks like the page it was drawn as: stacked bars, a period menu, and a by-time table in plain words.

  The activity plot used to be a smooth line per provider over an unlabelled scale. It is now one stacked bar per period, each band a provider's share of that period's cost or tokens, with six dates under it and a hover that reads out every provider plus the total.

  The window is a menu — Past 24 hours, Past 7 days, Past 30 days, Past 90 days — instead of a row of toggles, and the chart sits in a bordered card. The breakdown below is one card whose title follows the toggle, and its by-time view is a Period / Cost / Tokens table rather than a column per provider, so it fits a phone. The provider list collapses to a single line per provider below `sm`, and the page carries a back control in its top bar.

  While a page load is in flight the placeholders now hold still instead of sweeping, because a loop that never settles reads as a stuck page. A failed environment's row is red with a Retry button.

- [#339](https://github.com/mohammadchehab/isnadibot/pull/339) [`668d075`](https://github.com/mohammadchehab/isnadibot/commit/668d075bb6bd347194fef0bc95dc6ebe22e2bb8a) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - The Usage provider chart's hover readout no longer prints $0.00 for a window nobody priced.

  The headline, the caption and the dollar cells already say no provider reports a price for the period. The tooltip was the one surface that still disagreed: hovering a bar printed **$0.00**, which reads as "this cost nothing" when the truth is "nobody knows". It now shows an em dash under the same caption, and prints dollars again as soon as any record in the window carries a price.

- [#280](https://github.com/mohammadchehab/isnadibot/pull/280) [`6489f13`](https://github.com/mohammadchehab/isnadibot/commit/6489f13020cb8c4ce87687bd95c060ff691d7d24) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - A card that refuses an action now says why. The Tasks board and the card dialog used to toast only "Could not update the card"; they now name the reason in your own language — the action does not fit the card's current state, the space already holds as many open cards as it can, the card was already closed elsewhere, or the owner you picked has left the space.

- Updated dependencies [[`7b0f760`](https://github.com/mohammadchehab/isnadibot/commit/7b0f760bf87a9321d969f8e2d6241a6ab81ea334), [`9e2060e`](https://github.com/mohammadchehab/isnadibot/commit/9e2060e21ecbbf4655cbe725846fe6f02983f951)]:
  - @isnadi/contracts@0.1.0
  - @isnadi/client-runtime@0.0.7
  - @isnadi/shared@0.0.7

## 0.0.2

### Patch Changes

- Updated dependencies []:
  - @isnadi/contracts@0.0.2
  - @isnadi/client-runtime@0.0.6
  - @isnadi/shared@0.0.6

## 0.0.1

### Minor Changes

- [#13](https://github.com/mohammadchehab/isnadibot/pull/13) [`daaa280`](https://github.com/mohammadchehab/isnadibot/commit/daaa2800ec88c79b659d2a78cec81dc84a3f154e) Thanks [@mohammadchehab](https://github.com/mohammadchehab)! - The product is now IsnadiBot everywhere: the `isnadi` command, `ISNADI_*` environment variables, `~/.isnadi`, and the `isnadi://` desktop scheme. Existing data moves over on first launch, including the server database, the app's stored settings and themes, saved connections, in-app browser sessions, and old chat blocks and archives. The old `AKERU_*` environment variables still work. Product feedback is off until you set your own endpoint.

### Patch Changes

- [`66ba44d`](https://github.com/mohammadchehab/isnadibot/commit/66ba44dfcde1fbb3e63cf27f2afb73001baa26c5) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Use the selected terminal scrollbar colors and keep waiting labels and placeholders static.

- [`66ba44d`](https://github.com/mohammadchehab/isnadibot/commit/66ba44dfcde1fbb3e63cf27f2afb73001baa26c5) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Fix stacked charts and chart fragment children, and restore input focus when clicking an addon icon.

- [`0e8ddb1`](https://github.com/mohammadchehab/isnadibot/commit/0e8ddb1c42106a493299d77a1ac686860d3f71d6) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Buttons next to text fields, such as Connect on the provider sign-in code field, now match the field's height.

- [`66ba44d`](https://github.com/mohammadchehab/isnadibot/commit/66ba44dfcde1fbb3e63cf27f2afb73001baa26c5) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Restore image compression fallbacks when browser APIs are missing, and preserve valid composer model selections when another stored provider selection is malformed.

- [`f6ae162`](https://github.com/mohammadchehab/isnadibot/commit/f6ae1623eb53fcc0fbd5a0f2b0a5d6f0a95bebc0) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Usage now opens as a full page like Plugins, hiding the bot list and using the window width.

- [`66ba44d`](https://github.com/mohammadchehab/isnadibot/commit/66ba44dfcde1fbb3e63cf27f2afb73001baa26c5) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Make markdown alerts, connection status, and quit feedback follow the selected theme colors.

- Updated dependencies []:
  - @isnadi/contracts@0.0.1
  - @isnadi/client-runtime@0.0.5
  - @isnadi/shared@0.0.5

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @isnadi/contracts@0.2.1
  - @isnadi/client-runtime@0.0.4
  - @isnadi/shared@0.0.4

## 0.2.0

### Minor Changes

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Archive a bot from its roster menu and restore it from Archived. An empty roster now shows a Create bot prompt.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - While a bot works, the chat shows a small pixel meter with the current step and elapsed time. You can change a bot's model from the composer, and routine runs appear as notes in the bot's chat.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Type `@` in the composer to mention the preview browser or another chat. A chat mention gives the bot a short excerpt of that chat's recent turns, and `@browser` asks the bot to use the preview browser when bot browser access is on. Bots that share a name both appear in the menu, and picking one routes the message to that bot.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Hold the microphone in an empty chat composer to dictate a message on web, desktop, and mobile. Isnadi transcribes through the environment's voice provider and inserts the text at the cursor without sending it.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Memory now lists durable facts by chat, bot, or project scope, with their source, approval state, and replaced value, on desktop, web, and mobile. Durable facts can be exported per scope, and importing them asks you to choose a version for each conflict before anything changes.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Add Image generation settings with separate ChatGPT and Grok rows, honest health tests, a default provider and fallback order, and a per-bot image provider choice. Mobile shows the saved setup.

- upstream #296 [`268ea1a`](https://github.com/mohammadchehab/isnadibot/commit/268ea1a3feb0f6713b3dfde8e6b4e72242e77877) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Bot avatars are now flat shapes in a brighter palette, with slanted eyes cut out of the body. Bots on an older preset color move to the matching new one. A working bot sways, glances down at its work, and turns its face around its body now and then. Pointing at a bot widens its eyes and makes them follow the pointer. Resting bots stay still apart from an occasional blink or glance, and all motion respects your reduced-motion setting. Dithered avatars are gone: the picker no longer offers generated identicons or a dither filter, and bots that had one now show a shape.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Desktop setup now asks what you want your bot to help with and shows a short plan based on your answer. The last step drafts your first message from that plan. After you send it, setup waits until your bot has started, plays a short one-time celebration, and opens the chat with your message already there. With reduced motion turned on, the plan appears right away and the celebration is skipped.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Settings > Providers now says which subscription or key unlocks each provider, whether that subscription includes API access, the limits each provider publishes, what this environment has saved, and one next step. A provider shows Ready only after a request to it succeeds. Mobile Settings shows the same information, in English and Simplified Chinese.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Routines open into a detail view with their schedule, latest run, instructions, and workspace. A bot's shared browser capture expands with Open and collapses with Esc.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - The `$` skill menu shows each skill's own emoji, falling back to the glyph for where the skill came from. Selected skills appear as a larger tinted chip with the same emoji, in the composer and in sent messages, and still send as `$name`. The mobile command menu shows the emoji too.

### Patch Changes

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Keep group chat send available when a configured member can reply.

- upstream #291 [`5ff172b`](https://github.com/mohammadchehab/isnadibot/commit/5ff172b8d6ed1c67d4d75988860e122a58289282) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Keep independent chats responsive during provider setup and workspace refreshes, and avoid repeated work during streaming updates.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Checklists with two or more tasks in chat now show a static progress summary, such as "2 of 3 done".

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Diff and patch code blocks in chat now render as change cards with added and removed lines tinted and a count of changed lines.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Streaming answers in chat no longer flash a half-typed code fence, table, list marker, or heading underline. The partial line appears once it can render the way the finished message will.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Show the voice connection settings labels in English and Chinese without a missing-translation error.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Allow specialist mentions without a boss and exclude disabled providers from group send availability.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - The command palette lists bots first and keeps chats and projects above commands when you search, so a matching chat is no longer buried under commands.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Show mobile remote health controls in English and Chinese without missing labels.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Keep file locations and their explanations visible in bot failure messages.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Keep routine notes current in an open chat and show the speaker after each note.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Queue group chat follow-ups while the first message is being accepted, preserving one conversation.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - The Plugins directory shows listed integrations while verification is pending, with their connection status visible.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - In a group chat, an @mention of a name that two bots share no longer picks one of them at random. The composer explains the clash and holds the message until one bot is renamed.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - The group sidebar now reads a removal hint only on the remove buttons it explains, suggests creating a bot when every bot is already in the group, and shows that state as a note under Add bot instead of in the picker.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Hosted pairing links only pair when the token is in the link's fragment. A link that sends the token in the query string is refused.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - A hosted pairing link that names the address serving the page now signs in to that address, so **Open app** opens the app instead of asking to pair again.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - The hosted pairing page reads the link again when the complete link is opened in the same tab, instead of still saying it is incomplete.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Image generation settings now show loading and unavailable states with a retry instead of an empty history, and Connect opens the right provider sign-in for the same environment. Mobile shows the same provider details as desktop, and the bot editor marks image providers that are off or not connected.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Keep a newly created bot's pending chat until it appears in the environment roster.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Keep delegated child work from replacing a bot or group's latest chat.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Refresh open chat date and time labels after the device timezone changes.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Report terminal paint latency for the latest unkeyed arrival when earlier output was overwritten.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Allow group chats to use a configured bot or project provider when the app default is empty.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - The command palette finds each group's current chat in one pass, so opening it stays fast with a long group chat history.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Command palette chat search lists chats you can open before chats from another environment, so those never push an openable chat out of the results.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - The command palette's search box now says it searches commands and chats.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Command palette chat results from another environment show their bot or group name, read from that environment's roster.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Command palette results always match what you typed, so pressing Enter right after typing no longer runs a result from the previous search.

- upstream #300 [`72865f7`](https://github.com/mohammadchehab/isnadibot/commit/72865f7b06c8737ad32e52e215bcac5a6a3a8d43) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Smoother streaming in chats: bot replies update the conversation once per batch instead of once per token, and typing a message no longer re-renders the whole chat.

- upstream #299 [`5ae2952`](https://github.com/mohammadchehab/isnadibot/commit/5ae2952e4ee70f753863dda1f8fb0783a978f20b) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Smoother web chats: long conversations stop re-rendering on every update, and working-bot animations use far less GPU.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Keep a bot's saved provider selection unavailable instead of showing a different provider as selected.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Clickable controls now show the pointer cursor everywhere in the app, including checkboxes, radios, labels, tabs, menu items, and file inputs. Disabled controls keep the default cursor.

- upstream #292 [`0693f24`](https://github.com/mohammadchehab/isnadibot/commit/0693f24f28145a5fc7cfe32563c5b9a11f8467a7) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Reposition IsnadiBot's public messaging as an open-source, self-hosted Grok Bot alternative.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Settings > Providers, chat table and code controls, file links, notifications, and the sidebar now translate to Simplified Chinese.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Keep routine creation and run notes in bot chats after the routine is deleted.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Failed chat requests now show a short explanation and a next step instead of the raw error, with the technical details one click away. The mobile resume card shows the same summary.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Keep a bot's saved unavailable provider visible in the composer so users can choose a working model.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Show deleted routine history as read-only chat notes instead of opening an unrelated Routines panel.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - The roster task chip keeps its own shape on a hovered or selected bot row instead of blending into the row background.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Roster previews now read chat markdown the way the chat renders it, so code samples, URLs, and odd characters in a message stay intact in the preview line.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - The bot roster now shows the bot's current chat title as a task chip between its name and the timestamp.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - The bot roster stays blank until its first snapshot arrives, instead of briefly saying "No bots yet" right after pairing.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Keep literal image examples inside code spans in long chat previews.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Screen readers no longer hear a doubled period before "Open Routines" on routine receipts.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Dialog backdrops are more opaque and no longer blur the whole window, and selected and disabled states share one color across the app.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Settings chips in chat can now open Bot channels, Browser, Plugins, Sandbox, and Privacy. On mobile, in-app links no longer reach the system browser, and chips without a matching mobile screen open Settings.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Settings groups its sections by task and shows a loading skeleton, the sidebar footer labels its links, Featured plugins show what they do, and the usage table scrolls on narrow windows.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Ignore archived group members when checking provider availability and give a clear mention hint when the boss cannot reply.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Load recent routine notes first and fetch older notes on demand in bot chats.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - A Settings link in chat that Isnadi does not recognize now shows as plain text instead of a link that could open outside the app.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Show new chat, channel, pairing, and settings labels in English and Chinese.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - The sidebar update button now matches the other sidebar icons. Download progress draws inside the icon instead of around the whole button, the "update available" dot is gone, and the button uses the shared control radius.

- upstream #322 [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad) Thanks [@leoisadev1](https://github.com/leoisadev1)! - Explain when an archived new bot can no longer open its first chat, and clear the pending handoff.

- Updated dependencies [[`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad), [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad), [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad), [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad), [`630de12`](https://github.com/mohammadchehab/isnadibot/commit/630de12aeb4fe350ec957af323566a31aa85ebad)]:
  - @isnadi/contracts@0.2.0
  - @isnadi/client-runtime@0.0.3
  - @isnadi/shared@0.0.3

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @isnadi/contracts@0.1.1
  - @isnadi/client-runtime@0.0.2
  - @isnadi/shared@0.0.2

## 0.1.0

### Patch Changes

- Updated dependencies []:
  - @isnadi/contracts@0.1.0
  - @isnadi/client-runtime@0.0.1
  - @isnadi/shared@0.0.1

### Changes

- upstream #193 fix(marketing): connect Grok discovery pages to setup
- upstream #194 feat(web): add Read aloud for stored bot replies
- upstream #196 fix(marketing): recover downloads from stalled release requests
- upstream #197 perf(server): yield between filtered workspace search pages
- upstream #198 perf(protocol): make raw event retention opt-in
- upstream #201 perf(server): acquire browser attachments only for consuming connectors
- upstream #199 perf(server): index projected thread lookups
- upstream #204 fix(server): prefer origin for project repository identity
- upstream #205 fix(server): bound OpenCode CLI probes and serialize inventory
- upstream #207 fix(server): stop Windows terminal processes when closing
- upstream #211 fix(server): stop Windows terminal polling from spiking CPU
- upstream #219 fix(web): stop highlighter freezes by using Oniguruma WASM
- upstream #234 fix(mcp): allow text-only preview snapshots
- upstream #236 fix(server): bound session listing and keep a full idle window after turns
- upstream #238 fix(web): show bot and group message actions on touch
- upstream #249 fix(server): skip disabled provider instances for text generation fallback
- upstream #250 fix(server): preserve inline provider secrets on redacted saves
- upstream #231 fix(web): copy text over plain HTTP
- upstream #244 fix(server): stop overpricing cached Claude tokens
- upstream #246 perf(web): stop rendering hidden terminals
- upstream #233 fix(web): keep settings inputs focused during IME composition
- upstream #206 perf(server): bound terminal history incrementally
- upstream #255 perf(web): keep chat markdown mounted while text streams
- upstream #230 perf(server): skip full thread loads on projection and ingestion
- upstream #209 fix(codex): keep app-server protocol decode current
- upstream #226 feat(server): report image dimensions with signed asset URLs
- upstream #208 fix(server): isolate remote web session cookies
- upstream #227 perf(client): keep latestTurn and checkpoint refs stable while streaming
- upstream #164 feat(plugins): add local Executor MCP support
- upstream #200 perf(server): share concurrent usage reads and pricing refreshes
- upstream #202 fix(web): keep reply playback hooks stable during chat hydration
- upstream #203 perf(logging): drain bounded asynchronous writes before desktop exit
- upstream #210 fix(server): stop OpenCode child sessions and route their approvals
- upstream #256 fix(web): make desktop onboarding resilient
- upstream #257 fix(providers): hide disconnected providers
- upstream #252 fix(server): auto-reply full-access OpenCode permission asks
- upstream #212 fix(opencode): revert from the first removed assistant message
- upstream #258 feat(web): add custom bot avatar colors
- upstream #213 fix(mobile): preserve drafts after storage read failures
- upstream #214 fix(grok): probe health with initialize and allow in-session model changes
- upstream #224 fix(grok): encode session/cancel as a real notification and interrupt steers
- upstream #228 fix(grok): map Always allow to allow_once when Grok omits allow_always
- upstream #225 fix(grok): discover skills with grok inspect and fail workspace probes loudly
- upstream #220 fix(server): capture complete turn checkpoints after edits finish
- upstream #229 fix(server): keep attachments until commit and allow first-send retry
- upstream #215 fix(ssh): keep managed remote server ownership through stop
- upstream #216 perf(server): bound orchestration replay and slow-client live buffers
- upstream #217 fix(desktop): separate LAN and Tailscale pairing endpoints
- upstream #218 feat(web): complete live roster drag for bots and groups
- upstream #221 fix(editors): open remote projects in Zed
- upstream #222 feat(desktop): complete quit shortcut confirmation modes
- upstream #223 fix(desktop): pin preview CDP debugger across webview teardown
- upstream #232 fix(desktop): isolate preview shortcuts from the host
- upstream #235 fix(desktop): enable context menus in the in-app browser
- upstream #237 fix(claude): derive usage and name login or limit errors
- upstream #239 perf(server): stream static files and cache hashed build assets
- upstream #240 perf(server): drop transient native events from provider logs
- upstream #241 fix(threads): keep completed questions closed across clients
- upstream #242 perf(client): stop replaying terminal buffers on rollover
- upstream #243 feat(web): add provider model bulk visibility toggle
- upstream #245 fix: stop favicon requests for private chat-link hosts
- upstream #247 fix(server): disable executable tools in Claude metadata generation
- upstream #248 perf(web): avoid repeated terminal metadata scans
- upstream #251 perf(server): index OpenCode text by message and drop unused tool parts
- upstream #253 feat(shared): map text generation models by provider identity
- upstream #254 fix(claude): run composer-picked skills as slash commands

## @isnadi/web@0.0.40

### Changes

- upstream #176 feat(providers): add API key connections with custom endpoints
- upstream #178 fix(server): keep libsql native loader external to the CLI bundle
- upstream #182 fix(desktop): own dev and smoke Electron processes instead of pkill
- upstream #180 feat(scripts): add dev status, worktree setup, UI fixtures, and pairing helpers
- upstream #183 docs(agents): add verification policy and rewrite testing skills
- upstream #184 fix(desktop): stop claiming legacy t3code:// protocol schemes
- upstream #185 fix(release): recover version PR updates from Tegami's boxed errors
- upstream #188 fix(feedback): send product feedback to the deployed Worker
- upstream #191 feat(web): add Isnadi Noir and flatten shared controls
- upstream #189 feat(install): add release-pinned installer scripts
- upstream #192 fix(plugins): renew stale Hoplite OAuth registrations
- upstream #190 feat(channels): connect external conversations to bots

## @isnadi/web@0.0.39

### Changes

- upstream #141 fix(web): mute routine notices and update actions
- upstream #151 feat(marketing): add feedback.md, versioned metadata API, rate-limit headers
- upstream #153 fix(desktop): recover failed update installs
- upstream #154 fix(release): require signed macOS builds
- upstream #155 fix(desktop): package lazy server dependencies
- upstream #156 fix(mcp): open OAuth authorization requests
- upstream #149 feat(marketing): report page requests to Notra GEO
- upstream #158 ci: migrate Depot workflows to Tenki
- upstream #150 fix(settings): remove obsolete thread controls
- upstream #159 fix(chat): improve bot conversation usability
- upstream #157 feat(plugins): add Composio integrations
- upstream #162 fix(plugins): complete OAuth connections
- upstream #163 feat(marketing): add Grok search pages

## @isnadi/web@0.0.38

### Changes

- upstream #126 fix(web): replace sidebar footer labels with icons
- upstream #109 docs: update user guides for subscription runtimes
- upstream #127 feat(web): switch bots with number shortcuts
- upstream #129 fix(web): show Grok models during limited probes
- upstream #135 docs: align agent guidance with IsnadiBot
- upstream #138 ci: validate merge queue candidates with Depot
- upstream #139 feat(bots): move model controls to sidebar
- upstream #136 fix(channels): restore settings and delivery
- upstream #140 feat(bots): personalize Isnadi prompts
- upstream #144 ci: run Depot checks on pull requests
- upstream #146 ci: migrate workflows to tenki
- upstream #142 feat(plugins): add Hoplite MCP integration
- upstream #147 fix(brand): use the Isnadi icon in development
- upstream #143 perf(server): reduce streaming and tool update overhead
- upstream #148 perf(ui): replace class merging with cn
- upstream #137 feat(providers): add OpenCode Go support
- upstream #145 feat(web): add first-install bot onboarding
- upstream #123 fix(macos): install unsigned Mac builds from a checksummed GitHub DMG
- upstream #133 feat(approvals): add auto review and bot prompts

## @isnadi/web@0.0.37

### Changes

- upstream #124 fix(web): prevent duplicate bot panes

## @isnadi/web@0.0.36

### Changes

- upstream #114 fix(release): ship desktop apps without CLI
- upstream #115 fix(legal): preserve licenses and correct fork attribution
- upstream #116 feat(marketing): explain unsigned macOS downloads
- upstream #117 fix(release): launch packaged desktop apps before publishing

## @isnadi/web@0.0.35

### Changes

- upstream #11 feat(voice): add local desktop bot calls
- upstream #14 feat(brand): add lowercase Isnadi icon
- upstream #15 fix(usage): stabilize provider logos and labels
- upstream #13 ci: run Isnadi checks on Depot
- upstream #12 fix(voice): make local calls realtime
- upstream #16 perf(runtime): adopt provider-neutral upstream fixes
- upstream #18 feat(feedback): add the product feedback workflow
- upstream #17 feat(bots): add connector health and error inbox
- upstream #19 feat(plugins): load declarative catalog entries
- upstream #20 feat(plugins): ship the curated plugin directory
- upstream #28 test(mobile): cover bot inbox empty and error states
- upstream #21 fix(server): persist Kimi device identity
- upstream #23 feat(settings): add bot workspace and browser sharing
- upstream #22 feat(contracts): define Isnadi memory and usage records
- upstream #25 fix(server): redact browser snapshot data
- upstream #24 feat(server): add durable bot memory storage
- upstream #27 feat(contracts): define approved Isnadi workspace tools
- upstream #32 feat(server): add sandbox browser runtime
- upstream #29 feat(providers): add Kimi For Coding runtime
- upstream #31 feat(server): add bot inbox controls
- upstream #33 feat(web): resolve bot inbox incidents
- upstream #38 feat(mobile): resolve bot inbox incidents
- upstream #36 feat(server): isolate and pool bot workspaces
- upstream #37 fix(memory): preserve storage correctness
- upstream #39 feat(server): run approved Isnadi tools
- upstream #41 feat(server): add governed memory tool handlers
- upstream #40 feat(server): record human handoff incidents
- upstream #35 feat(server): enforce per-bot token usage caps
- upstream #44 fix(memory): preserve pending update governance
- upstream #45 feat(memory): add RPC and shared client state
- upstream #48 feat(server): expose per-bot usage over RPC
- upstream #50 feat(web): show per-bot usage
- upstream #53 feat(portability): restore archives across environments
- upstream #52 feat(memory): wire governed memory tools into Mastra
- upstream #46 feat(web): manage bot memory
- upstream #55 feat(bots): reply before tools with status beats
- upstream #49 feat(memory): observe new thread messages
- upstream #57 chore(contributing): verify plugin proposal policy
- upstream #61 test(server): prove saved provider routing
- upstream #54 feat(app): ask before local agent commands
- upstream #62 fix(server): redact screenshot tool results
- upstream #59 feat(server): track MCP connector health
- upstream #58 fix(plugins): align directory with connector lifecycle
- upstream #60 feat(analytics): send anonymous usage summaries
- upstream #64 feat(server): delegate work between bots
- upstream #67 feat(marketing): rebuild the landing page from the Paper design
- upstream #65 feat(providers): finish native Kimi support
- upstream #66 fix(server): preserve rewritten Mastra replies
- upstream #63 feat(server): add durable remote sandboxes
- upstream #74 feat(server): let bot bosses manage channels
- upstream #69 feat(server): run browsers in remote sandboxes
- upstream #80 feat(server): let bots message the current thread
- upstream #71 fix(web): keep group avatars during search
- upstream #72 fix(web): widen rich bot output
- upstream #73 fix(analytics): report opt-out deletion failures
- upstream #75 feat(server): manage MCP connections from bots
- upstream #76 feat(bots): show sensitive approval cards
- upstream #82 feat(server): let bots install URL plugins
- upstream #56 feat(isnadi): finish sandbox and memory reliability
- upstream #68 feat(plugins): add local Codex computer use
- upstream #85 feat(marketing): add PostHog web analytics
- upstream #84 fix(memory): bind legacy workspace access to original project
- upstream #87 feat(server): let bots update their own profiles
- upstream #77 feat(server): enforce bounded bot delegation
- upstream #91 fix(marketing): improve agent readiness
- upstream #78 feat(web): show and control bot delegations
- upstream #93 fix(marketing): finish agent readiness gaps
- upstream #88 feat(server): add bot plugin controls
- upstream #90 feat(server): add durable bot management tools
- upstream #83 feat(trust): ship privacy and control milestone
- upstream #86 feat(server): add MCP health controls
- upstream #92 feat(release): ship stable direct downloads
- upstream #89 feat(bots): react to visible messages
- upstream #81 feat(settings): connect remote sandbox providers
