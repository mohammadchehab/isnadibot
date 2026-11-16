---
"@isnadi/web": patch
---

A bot turn that dies no longer leaves its work item assigned forever. The item goes back in the queue after one short wait, and a second failure in a row blocks it with the reason on the card, so the bot stops reading as busy and the work behind it moves again.
