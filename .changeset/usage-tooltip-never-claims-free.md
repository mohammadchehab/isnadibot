---
"@isnadi/web": patch
---

The Usage provider chart's hover readout no longer prints $0.00 for a window nobody priced.

The headline, the caption and the dollar cells already say no provider reports a price for the period. The tooltip was the one surface that still disagreed: hovering a bar printed **$0.00**, which reads as "this cost nothing" when the truth is "nobody knows". It now shows an em dash under the same caption, and prints dollars again as soon as any record in the window carries a price.
