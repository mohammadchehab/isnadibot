import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Exit from "effect/Exit";

import {
  checkFixPr,
  CommandExecutor,
  fixPrBody,
  fixPrBranch,
  isProtectedBranch,
  openFixPr,
  type CommandResult,
  type OpenFixPrInput,
} from "./fixPr.ts";
import type { LinkFixPlan } from "./fixPlan.ts";

function plan(overrides: Partial<LinkFixPlan> = {}): LinkFixPlan {
  return { edits: [], fixes: [], unfixable: [], ...overrides };
}

function baseInput(overrides: Partial<OpenFixPrInput> = {}): OpenFixPrInput {
  return {
    grantedRepo: "/repo",
    repo: "/repo",
    docsRoot: "docs",
    branch: "link-monitor/fix-links-2026-11-13-10-00-00",
    plan: plan(),
    site: "https://docs.invalid",
    base: "main",
    ...overrides,
  };
}

function oneEdit(): LinkFixPlan {
  return plan({
    edits: [{ path: "docs/a.md", content: "[b](b.md)" }],
    fixes: [{ sourcePath: "docs/a.md", from: "docs/old.md", to: "b.md", kind: "repath" }],
  });
}

/** Records every command and answers with scripted output, so ordering is a plain array. */
function recorder(answers: Record<string, CommandResult> = {}) {
  const calls: { command: string; args: ReadonlyArray<string> }[] = [];

  const executor = {
    run: (command: string, args: ReadonlyArray<string>) => {
      calls.push({ command, args });

      const line = `${command} ${args.join(" ")}`;
      const key = Object.keys(answers).find((candidate) => line.startsWith(candidate));

      return Effect.succeed(
        key === undefined ? { code: 0, stdout: "", stderr: "" } : answers[key]!,
      );
    },
  };

  return { calls, executor };
}

/**
 * The real filesystem with writes captured instead of performed: these runs are
 * decided entirely by the fenced commands, and must never touch the developer's disk.
 */
function recordingFs(writes: { path: string; content: string }[]) {
  return (fs: FileSystem.FileSystem) =>
    ({
      ...fs,
      writeFileString: (path: string, contents: string) =>
        Effect.sync(() => {
          writes.push({ path, content: contents });
        }),
    }) satisfies FileSystem.FileSystem;
}

it("refuses when the checkout is not the repo the user granted", () => {
  assert.equal(
    checkFixPr(baseInput({ grantedRepo: "/repo/granted", repo: "/repo/other" })),
    "target-not-granted",
  );
});

it("refuses a docs root that climbs out of the repo", () => {
  assert.equal(checkFixPr(baseInput({ docsRoot: "../outside" })), "docs-outside-repo");
});

it("refuses every protected branch name", () => {
  for (const branch of ["main", "Master", "HEAD", "trunk", "develop", "release"]) {
    assert.equal(checkFixPr(baseInput({ branch })), "protected-branch", branch);
    assert.isTrue(isProtectedBranch(branch), branch);
  }

  assert.isFalse(isProtectedBranch("link-monitor/fix-links-2026-11-13"));
});

it("refuses an edit outside the docs root", () => {
  const input = baseInput({
    plan: plan({ edits: [{ path: "apps/server/src/index.ts", content: "" }] }),
  });

  assert.equal(checkFixPr(input), "edit-outside-docs");
});

it("passes the envelope for a well-formed run", () => {
  assert.isNull(checkFixPr(baseInput({ plan: oneEdit() })));
});

it("names the branch without ever matching a protected name", () => {
  assert.equal(
    fixPrBranch(new Date("2026-11-13T10:11:12.000Z")),
    "link-monitor/fix-links-2026-11-13-10-11-12",
  );
});

it.effect("opens the PR in the one order the envelope allows", () =>
  Effect.gen(function* () {
    const fake = recorder({
      "gh pr create": { code: 0, stdout: "https://example.invalid/pr/1\n", stderr: "" },
    });

    const writes: { path: string; content: string }[] = [];
    const fs = yield* FileSystem.FileSystem;

    const result = yield* openFixPr(baseInput({ plan: oneEdit() })).pipe(
      Effect.provideService(FileSystem.FileSystem, recordingFs(writes)(fs)),
      Effect.provideService(CommandExecutor, fake.executor),
    );

    assert.deepEqual(result, {
      kind: "opened",
      branch: "link-monitor/fix-links-2026-11-13-10-00-00",
      url: "https://example.invalid/pr/1",
    });
    assert.deepEqual(writes, [{ path: "/repo/docs/a.md", content: "[b](b.md)" }]);
    assert.deepEqual(
      fake.calls.map((call) => `${call.command} ${call.args[0]}`),
      ["gh pr", "git switch", "git add", "git commit", "git push", "gh pr"],
    );

    const push = fake.calls.find((call) => call.command === "git" && call.args[0] === "push");
    assert.deepEqual(push?.args, [
      "push",
      "origin",
      "HEAD:refs/heads/link-monitor/fix-links-2026-11-13-10-00-00",
    ]);
    assert.isFalse(push?.args.some((arg) => arg === "main" || arg === "refs/heads/main") ?? true);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("stops before any write when a PR is already open for the branch", () =>
  Effect.gen(function* () {
    const fake = recorder({ "gh pr list": { code: 0, stdout: '[{"number":7}]', stderr: "" } });
    const writes: { path: string; content: string }[] = [];
    const fs = yield* FileSystem.FileSystem;

    const result = yield* openFixPr(baseInput({ plan: oneEdit() })).pipe(
      Effect.provideService(FileSystem.FileSystem, recordingFs(writes)(fs)),
      Effect.provideService(CommandExecutor, fake.executor),
    );

    assert.deepEqual(result, { kind: "refused", refusal: "pr-already-open" });
    assert.deepEqual(
      fake.calls.map((call) => call.command),
      ["gh"],
    );
    assert.deepEqual(writes, []);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("runs nothing at all when the plan has no edits", () =>
  Effect.gen(function* () {
    const fake = recorder();

    const result = yield* openFixPr(baseInput()).pipe(
      Effect.provideService(CommandExecutor, fake.executor),
    );

    assert.deepEqual(result, { kind: "nothing-to-fix" });
    assert.deepEqual(fake.calls, []);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("runs nothing at all when the branch is protected", () =>
  Effect.gen(function* () {
    const fake = recorder();

    const result = yield* openFixPr(baseInput({ branch: "main", plan: oneEdit() })).pipe(
      Effect.provideService(CommandExecutor, fake.executor),
    );

    assert.deepEqual(result, { kind: "refused", refusal: "protected-branch" });
    assert.deepEqual(fake.calls, []);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("fails loudly rather than claiming a PR when the push fails", () =>
  Effect.gen(function* () {
    const fake = recorder({
      "git push": { code: 128, stdout: "", stderr: "remote rejected" },
    });

    const writes: { path: string; content: string }[] = [];
    const fs = yield* FileSystem.FileSystem;

    const exit = yield* Effect.exit(
      openFixPr(baseInput({ plan: oneEdit() })).pipe(
        Effect.provideService(FileSystem.FileSystem, recordingFs(writes)(fs)),
        Effect.provideService(CommandExecutor, fake.executor),
      ),
    );

    assert.isTrue(Exit.isFailure(exit));
    assert.isFalse(fake.calls.some((call) => call.command === "gh" && call.args[0] === "create"));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it("writes the PR body with every link it could not fix", () => {
  const body = fixPrBody(
    plan({
      edits: [{ path: "docs/a.md", content: "" }],
      fixes: [{ sourcePath: "docs/a.md", from: "docs/old.md", to: "b.md", kind: "repath" }],
      unfixable: [
        {
          link: { sourcePath: "docs/a.md", target: "https://example.invalid/x", reason: "timeout" },
          reason: "external",
        },
      ],
    }),
  );

  assert.include(body, "`docs/old.md` → `b.md`");
  assert.include(body, "https://example.invalid/x");
  assert.include(body, "external");
});
