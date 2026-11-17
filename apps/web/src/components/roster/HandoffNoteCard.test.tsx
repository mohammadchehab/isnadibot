import { HandoffDoc } from "@isnadi/contracts";
import { Schema } from "effect";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { HandoffNoteCard } from "./HandoffNoteCard";

const doc = Schema.decodeUnknownSync(HandoffDoc);

describe("HandoffNoteCard", () => {
  it("draws the note's six rows in the order a reader picks it up", () => {
    const markup = renderToStaticMarkup(
      <HandoffNoteCard
        doc={doc({
          item: "Outreach to C-104",
          branch: "tailor/outreach-c-104",
          done: "First draft written",
          nextStep: "Shorten to 120 words",
          waitingOn: "Nothing",
          doNot: "Send before Tracker approves",
        })}
      />,
    );

    expect(markup.match(/>[^<>]+</g)?.map((text) => text.slice(1, -1))).toEqual([
      "Card",
      "Outreach to C-104",
      "Branch",
      "tailor/outreach-c-104",
      "Done",
      "First draft written",
      "Next",
      "Shorten to 120 words",
      "Waiting on",
      "Nothing",
      "Don’t",
      "Send before Tracker approves",
    ]);
  });

  // An empty label says less than the row it would take up.
  it("leaves out the fields the bot had nothing to say about", () => {
    const markup = renderToStaticMarkup(
      <HandoffNoteCard doc={doc({ nextStep: "Shorten to 120 words" })} />,
    );

    expect(markup).toContain("Next");
    expect(markup).not.toContain("Card");
    expect(markup).not.toContain("Waiting on");
    expect(markup).not.toContain("Don’t");
  });
});
