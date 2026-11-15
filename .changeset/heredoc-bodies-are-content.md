---
"isnadibot": patch
---

Writing a file no longer asks for approval as if it were deleting or sending
something. Both command classifiers read the whole raw command, so the text
inside a heredoc body — a README saying "delete a todo", a script importing
`node:crypto` — was read as the command's intent. Bodies are now stripped
before classifying, in every quoting form the shell accepts.

An unterminated heredoc is deliberately left whole: it swallows the rest of the
command, so dropping what follows a stray opener would hide a real destructive
command behind it.
