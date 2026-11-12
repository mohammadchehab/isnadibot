---
"isnadibot": patch
---

Upgrading from a very old version no longer stores saved model options as a quoted string. The migration that converts legacy object-shaped options into the current array shape now writes a real array on SQLite 3.54 and newer, so older projects and chats keep loading their saved options correctly.
