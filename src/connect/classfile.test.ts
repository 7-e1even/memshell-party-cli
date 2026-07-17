import { describe, expect, it } from "vitest";

import { ECHO_CLASS_BYTES } from "./assets.js";
import { injectStringConstant, readStringConstant } from "./classfile.js";

describe("injectStringConstant", () => {
  it("adds a ConstantValue to a field that has none", () => {
    expect(readStringConstant(ECHO_CLASS_BYTES, "content")).toBeNull();

    const value = `test-${"x".repeat(60)}-content`;
    const patched = injectStringConstant(ECHO_CLASS_BYTES, "content", value);

    expect(readStringConstant(patched, "content")).toBe(value);
    // magic / minor / major untouched (pool count at offset 8 grows by design)
    expect(patched.readUInt32BE(0)).toBe(0xcafebabe);
    expect(patched.subarray(4, 8)).toEqual(ECHO_CLASS_BYTES.subarray(4, 8));
  });

  it("handles unicode values and repeated injection", () => {
    const patched1 = injectStringConstant(ECHO_CLASS_BYTES, "content", "第一次");
    expect(readStringConstant(patched1, "content")).toBe("第一次");
    const patched2 = injectStringConstant(patched1, "content", "second");
    expect(readStringConstant(patched2, "content")).toBe("second");
  });

  it("does not touch other fields", () => {
    const patched = injectStringConstant(ECHO_CLASS_BYTES, "content", "abc123");
    expect(readStringConstant(patched, "payloadBody")).toBeNull();
  });

  it("rejects non-class input and unknown fields", () => {
    expect(() => injectStringConstant(Buffer.from("nope"), "content", "x")).toThrow(
      "not a Java class file",
    );
    expect(() => injectStringConstant(ECHO_CLASS_BYTES, "noSuchField", "x")).toThrow("not found");
  });
});
