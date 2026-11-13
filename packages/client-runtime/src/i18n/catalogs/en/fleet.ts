/**
 * Fleet templates and roles. The contracts carry these names and descriptions for
 * the server and the card art; the screens show them through `t()`, so every key
 * here must match `packages/contracts/src/fleet/roles.ts` word for word.
 */
export const fleetCatalog = {
  // Templates
  Recruiting: "Recruiting",
  "Sources candidates, writes outreach, and tracks every opening.":
    "Sources candidates, writes outreach, and tracks every opening.",
  "Video editing": "Video editing",
  "Turns raw footage into cut, captioned, publish-ready videos.":
    "Turns raw footage into cut, captioned, publish-ready videos.",
  "Software engineering": "Software engineering",
  "Plans, builds, reviews, and ships changes in your repository.":
    "Plans, builds, reviews, and ships changes in your repository.",
  "Health research": "Health research",
  "Searches public health data, screens evidence, and summarises what holds up.":
    "Searches public health data, screens evidence, and summarises what holds up.",
  "Customer support": "Customer support",
  "Triages the inbox, answers what it can, and escalates the rest.":
    "Triages the inbox, answers what it can, and escalates the rest.",
  "Bookkeeping & procurement": "Bookkeeping & procurement",
  "Records spend, matches invoices, and runs purchase requests.":
    "Records spend, matches invoices, and runs purchase requests.",

  // Roles
  Scout: "Scout",
  "Sources candidates": "Sources candidates",
  Tailor: "Tailor",
  "Job posts and outreach": "Job posts and outreach",
  Tracker: "Tracker",
  "Pipeline and follow-ups": "Pipeline and follow-ups",
  Coach: "Coach",
  "Interview kits": "Interview kits",
  Producer: "Producer",
  "Plans the cut and the schedule": "Plans the cut and the schedule",
  Editor: "Editor",
  "Cuts footage into a story": "Cuts footage into a story",
  Captioner: "Captioner",
  "Captions and subtitles": "Captions and subtitles",
  Designer: "Designer",
  "Thumbnails and title cards": "Thumbnails and title cards",
  Planner: "Planner",
  "Plans the work and assigns it": "Plans the work and assigns it",
  Engineer: "Engineer",
  "Builds and tests changes": "Builds and tests changes",
  Reviewer: "Reviewer",
  "Reviews and merges pull requests": "Reviews and merges pull requests",
  Architect: "Architect",
  "Designs and finds root causes": "Designs and finds root causes",
  "UI designer": "UI designer",
  "Screens and design specs": "Screens and design specs",
  "Security reviewer": "Security reviewer",
  "Reviews security-relevant changes": "Reviews security-relevant changes",
  "Lead researcher": "Lead researcher",
  "Frames questions and signs off findings": "Frames questions and signs off findings",
  "Literature scout": "Literature scout",
  "Finds and screens papers": "Finds and screens papers",
  "Trials analyst": "Trials analyst",
  "Reads trial registries": "Reads trial registries",
  "Data analyst": "Data analyst",
  "Runs the numbers on public data": "Runs the numbers on public data",
  Triage: "Triage",
  "Sorts the inbox and routes it": "Sorts the inbox and routes it",
  Responder: "Responder",
  "Drafts replies": "Drafts replies",
  Escalations: "Escalations",
  "Handles the hard cases": "Handles the hard cases",
  Knowledge: "Knowledge",
  "Keeps help articles current": "Keeps help articles current",
  Controller: "Controller",
  "Approves spend and closes the books": "Approves spend and closes the books",
  Bookkeeper: "Bookkeeper",
  "Records spend and matches invoices": "Records spend and matches invoices",
  Buyer: "Buyer",
  "Runs purchase requests": "Runs purchase requests",
  Auditor: "Auditor",
  "Checks entries for mistakes": "Checks entries for mistakes",
} as const;
