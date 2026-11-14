---
"isnadibot": patch
---

Moving a bot to another group now removes it from its old group. Before, the bot stayed on the first group's roster while its own record pointed at the new group, which could corrupt group deletion and dispatch, and the move skipped the boss and minimum-membership guards.
