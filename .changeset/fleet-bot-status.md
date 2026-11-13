---
"isnadibot": minor
---

A bot's status is now one of four states — asking, held, busy, idle — derived from the chats, work items and delegated children it already has: it is asking when an approval or question waits on you anywhere in its chat tree, held when it owns a blocked item or its turn waits on a child, busy when a turn is running, and idle otherwise. Archived chats no longer count, and a delegated sub-chat reports as its root bot.
