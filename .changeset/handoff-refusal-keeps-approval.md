---
"isnadibot": patch
---

A refused handoff now says so instead of disappearing. The bot work limit was
checked twice, once by turn and once by bot, so a handoff the boss had already
been approved to send could fail before any bot work existed and leave nothing
for the boss to act on. The limit is now enforced in one place, a refusal
reports the reason, and the approval is handed back so the boss can retry
without asking the user again.
