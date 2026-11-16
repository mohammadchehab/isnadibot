---
"isnadibot": patch
---

A keep-busy team's dispatcher reads each member's status once per pass instead of once per member per queued item. A large team with many chats no longer spends most of a dispatch pass re-deriving the same answers, so handing out queued work stays fast as a space grows.
