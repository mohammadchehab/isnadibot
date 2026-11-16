---
"isnadibot": patch
---

A bot that finishes its turn on a card no longer counts that turn as a failed attempt. The card
goes back in the queue straight away and is handed to the next free teammate, so two finished
turns in a row no longer block it. A turn that really died or was interrupted is still reported,
and that line now names the bot whose turn it was.
