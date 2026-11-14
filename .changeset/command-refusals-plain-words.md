---
"isnadibot": patch
---

A refused command now explains itself in plain words instead of showing the server's internal message. Settings, roster and memory surfaces shared three hand-copied fallbacks that passed the server's text straight through, so a missing permission read as "Person '7f3a…' needs 'access:write' to change the environment" — an internal id and a scope name. One shared helper in the client now turns each refusal code the app knows into a translated sentence, and keeps the server's own wording only for a code it does not recognise.
