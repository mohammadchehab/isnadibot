---
"@isnadi/web": patch
---

A provider whose API key was revoked upstream now counts as unable to run a bot, the same as a revoked sign-in, so hiring a team reports the reconnect instead of creating bots whose every turn the server refuses. A provider instance that carries its own saved login is now judged by that login instead of passing through unchecked.
