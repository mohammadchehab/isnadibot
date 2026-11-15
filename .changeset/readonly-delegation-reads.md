---
"isnadibot": patch
---

A read-only delegation that was given the user's computer can now read files inside the folder its task names, with no approval card. A read outside that folder, including through a symlink or `..`, is refused with a message naming the folder, and protected files such as `.env` still need approval. When a read cannot run, the refusal says which grant is missing, so the boss can re-delegate.
