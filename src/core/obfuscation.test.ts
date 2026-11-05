import { describe, expect, it } from "vitest";

import { parseObfuscationOptions } from "./obfuscation.js";

describe("parseObfuscationOptions", () => {
  it("parses booleans, numbers and strings", () => {
    expect(
      parseObfuscationOptions("enableControlFlow=false,level=2,name=hello world\nratio=0.5"),
    ).toEqual({
      enableControlFlow: false,
      level: 2,
      name: "hello world",
      ratio: 0.5,
    });
  });

  it("rejects malformed and duplicate entries", () => {
    expect(() => parseObfuscationOptions("not-an-option")).toThrow("expected key=value");
    expect(() => parseObfuscationOptions("a=1,a=2")).toThrow("Duplicate");
  });

  it("returns undefined for an empty option", () => {
    expect(parseObfuscationOptions()).toBeUndefined();
    expect(parseObfuscationOptions(" ")).toBeUndefined();
  });
});
