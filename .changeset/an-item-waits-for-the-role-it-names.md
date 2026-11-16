---
"@isnadi/web": patch
---

An item can name the role that should take it, and the board no longer hands it to whoever happens to be free. If nobody in the space holds that role, the item waits instead of going to the wrong bot, and the chat says so in a row that names the missing role and what would unblock it. Hiring someone with that role is enough: the item moves on its own, without restarting anything. Items that name no role are handed out exactly as before.
