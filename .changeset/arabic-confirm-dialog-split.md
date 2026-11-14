---
"isnadibot": patch
---

Arabic confirmation dialogs now split into a title and a body the way English and Chinese ones already did. The split looked for an ASCII or fullwidth question mark, and Arabic, Persian and Urdu ask with U+061F, so the whole sentence was landing in the dialog title with a generic line underneath.
