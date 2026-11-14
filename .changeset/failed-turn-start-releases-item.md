---
"isnadibot": patch
---

A work item whose turn never started no longer stays assigned to a bot that is running nothing. The dispatcher gives the item back to the group's queue and says why in the bot's chat, instead of marking it assigned and leaving the bot stuck as busy.
