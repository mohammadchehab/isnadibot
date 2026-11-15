---
"@isnadi/web": patch
---

Creating a space no longer moves a bot out of the space it already belongs to. The
new-space dialog leaves out bots that already have a home, and the server refuses the
create with a plain sentence telling you to create the space without the bot and add it
afterwards.
