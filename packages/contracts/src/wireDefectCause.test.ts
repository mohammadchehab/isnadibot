import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";

import { WsRpcGroup } from "./rpc.ts";

/**
 * `Schema.Defect()` encodes the underlying failure's name, message and cause chain, so a raw
 * filesystem or provider error would reach every client. The error classes a request can fail with
 * carry structured fields instead (`reason`, `detail`, `operation`), and the failure itself stays
 * on the server as a native `Error` cause, which no schema encodes.
 *
 * This walks the real error schema of every WebSocket request, so putting a Defect back on any of
 * them — or on a new one — fails here.
 */
function defectsIn(ast: SchemaAST.AST, path: string, found: Array<string>): void {
  // A Defect is the Unknown node that carries an encoding; a plain `Schema.Unknown` has none.
  if (SchemaAST.isUnknown(ast)) {
    if (ast.encoding !== undefined) found.push(path === "" ? "<root>" : path);

    return;
  }

  if (SchemaAST.isObjects(ast)) {
    for (const property of ast.propertySignatures) {
      const name = String(property.name);
      defectsIn(property.type, path === "" ? name : `${path}.${name}`, found);
    }

    // A `Schema.Record` carries its value type here, not in a property signature.
    for (const index of ast.indexSignatures) {
      defectsIn(index.type, `${path}[key]`, found);
    }

    return;
  }

  // `Schema.Array` and `Schema.Tuple` are both an `Arrays` node: a tuple's fixed
  // positions are `elements`, an array's element type is in `rest`.
  if (SchemaAST.isArrays(ast)) {
    for (const element of ast.elements) defectsIn(element, `${path}[]`, found);

    for (const rest of ast.rest) defectsIn(rest, `${path}[...]`, found);

    return;
  }

  if (SchemaAST.isUnion(ast)) {
    for (const member of ast.types) defectsIn(member, path, found);

    return;
  }

  if (SchemaAST.isDeclaration(ast)) {
    for (const parameter of ast.typeParameters) defectsIn(parameter, path, found);

    return;
  }

  if (SchemaAST.isSuspend(ast)) {
    defectsIn(ast.thunk(), path, found);
  }
}

describe("A failure's Defect stays on the server", () => {
  it("appears in no request's error schema", () => {
    const offenders: Array<string> = [];

    for (const [name, rpc] of WsRpcGroup.requests) {
      const found: Array<string> = [];
      defectsIn(rpc.errorSchema.ast, "", found);

      if (found.length > 0) offenders.push(`${name} -> ${found.join(", ")}`);
    }

    expect(offenders).toEqual([]);
  });

  it("is caught when a new error puts one back on the wire", () => {
    class RegressedError extends Schema.TaggedErrorClass<RegressedError>()("RegressedError", {
      cause: Schema.optional(Schema.Defect()),
    }) {}

    const found: Array<string> = [];
    defectsIn(RegressedError.ast, "", found);

    expect(found).toEqual(["cause"]);
  });

  it("is caught inside an array, a tuple and a record, not just a field", () => {
    class RegressedError extends Schema.TaggedErrorClass<RegressedError>()("RegressedError", {
      cause: Schema.optional(Schema.Defect()),
    }) {}

    // Each of these nests the same Defect one shape deeper. Before the walker
    // descended Arrays and index signatures, every one of them found nothing.
    const shapes = {
      array: Schema.Array(RegressedError),
      tuple: Schema.Tuple([Schema.String, RegressedError]),
      record: Schema.Record(Schema.String, RegressedError),
    };

    for (const [shape, schema] of Object.entries(shapes)) {
      const found: Array<string> = [];
      defectsIn(schema.ast, "", found);

      expect({
        shape,
        found: found.length > 0 && found.every((at) => at.endsWith("cause")),
      }).toEqual({ shape, found: true });
    }
  });
});
