---
"isnadibot": patch
---

A keep-busy group now hands its next queued item to the bot that has been idle longest, instead of always to the first one by name. A bot that has never finished a turn goes first, and a tie falls back to the bot's id.
