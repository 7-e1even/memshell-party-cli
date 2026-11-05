import { describe, expect, it } from "vitest";

import { buildBytecodeTransformRequest } from "./bytecode.js";

describe("bytecode transform request", () => {
  it("maps relocation and ResponseHeader options", () => {
    expect(buildBytecodeTransformRequest("e30=", {
      relocateFrom: "javax.servlet",
      relocateTo: "jakarta.servlet",
      probeMethod: "ResponseHeader",
      respHeaderName: "X-Result",
      obfuscationOptions: "enableControlFlow=false",
    })).toEqual({
      classBytesBase64: "e30=",
      renamePackage: true,
      relocateFrom: "javax.servlet",
      relocateTo: "jakarta.servlet",
      obfuscation: { enabled: true, options: { enableControlFlow: false } },
      server: "Unknown",
      probe: {
        probeMethod: "ResponseHeader",
        probeContent: "Bytecode",
        respHeaderName: "X-Result",
      },
    });
  });

  it("rejects an incomplete package relocation", () => {
    expect(() => buildBytecodeTransformRequest("e30=", { relocateFrom: "javax.servlet" }))
      .toThrow(/both --relocate-from and --relocate-to/);
  });
});
