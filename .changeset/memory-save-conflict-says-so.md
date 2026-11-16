---
"@isnadi/web": patch
---

A memory save that loses to a change made somewhere else now tells you to reopen memory before saving, in plain words, instead of a generic failure. The server reports the conflict as a named condition rather than leaving every client to recognise it from the failure text.
