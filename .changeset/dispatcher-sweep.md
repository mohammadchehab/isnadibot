---
"isnadibot": patch
---

A keep-busy team no longer stops when the bot it picks has no chat yet. The dispatcher passes over
that member, works the rest of the queue, and picks the group up again as soon as the chat exists.
A lost claim no longer strands the items behind it, and one pass spends each bot once, so a bot in
two groups is handed one item.
