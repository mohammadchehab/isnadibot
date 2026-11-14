import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { FleetRoleId } from "./baseSchemas.ts";

const decodeRoleId = Schema.decodeUnknownSync(FleetRoleId);

const encodeRoleId = Schema.encodeSync(FleetRoleId);

it("decodes a role id from the wire", () => {
  assert.strictEqual(decodeRoleId("architect"), "architect");
});

it("refuses an empty role id", () => {
  assert.throws(() => decodeRoleId(""));
});

it("round-trips a role id, so a stored event decodes the same id", () => {
  const roleId = decodeRoleId("engineer");

  assert.strictEqual(decodeRoleId(encodeRoleId(roleId)), roleId);
});
