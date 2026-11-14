---
"isnadibot": patch
---

Deleting a group is now an administrator action, and it refuses to take open work down with it unless the caller asks for that explicitly. A plain member could previously delete any group they belonged to, which discarded every work item the group held — finished ones included — and detached its chats. Two refusals replace that: a person without `access:write` is turned away, and a group that still holds open work items fails with an error naming the count until `discardWorkItems` is passed.
