---
"isnadibot": minor
---

The link monitor can now repair broken docs links instead of only reporting them. It fixes links whose page redirected, whose relative path is wrong, or whose section was removed, and opens one pull request with the repairs — listing every link it deliberately left alone and why. It never pushes to a protected branch, never edits outside the docs it was pointed at, and refuses to run twice while its pull request is still open.
