import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ResolvedConnection } from "../core/targets.js";
import { saveProfile, type SiteProfile } from "../core/site-profile.js";
import { startMimicServer, type MimicServer } from "./mimic-server.js";
import {
  deriveAesKey,
  deriveLeftMarker,
  encodeRequestBody,
  injectIntoTemplate,
  decryptField,
  renderFieldValue,
} from "./mimic-shared.js";
import { mimicProtocol } from "./mimic.js";
import type { ProtocolRequest } from "./registry.js";

let server: MimicServer;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "memparty-profiles-"));
  process.env.MEMPARTY_PROFILES = dir;
  server = await startMimicServer();
});

afterEach(async () => {
  delete process.env.MEMPARTY_PROFILES;
  rmSync(dir, { recursive: true, force: true });
  await server.close();
});

function makeRequest(overrides: Partial<ProtocolRequest["options"]> = {}): ProtocolRequest {
  const conn: ResolvedConnection = {
    url: server.url,
    tool: "mimic",
    pass: "pass",
    key: "key",
    extraHeaders: {},
  };
  return {
    conn,
    common: { timeoutMs: 5_000 },
    options: overrides,
  };
}

const demoProfile: SiteProfile = {
  name: "unit",
  site: "http://127.0.0.1",
  createdAt: new Date().toISOString(),
  title: "unit test site",
  template: "<html><body>skin</body></html>",
  contentType: "text/html",
  paths: ["/api/", "/news/"],
};

describe("mimic protocol", () => {
  it("test() does a credential round-trip", async () => {
    const result = await mimicProtocol.test(makeRequest());
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("round-trip ok");
  });

  it("exec() runs a command and returns its output", async () => {
    const result = await mimicProtocol.exec!(makeRequest(), "echo mimic-canary-123");
    expect(result.ok).toBe(true);
    expect(result.output).toContain("mimic-canary-123");
  });

  it("fails with a wrong key", async () => {
    const req = makeRequest();
    req.conn = { ...req.conn, key: "wrong" };
    const result = await mimicProtocol.test(req);
    expect(result.ok).toBe(false);
  });

  it("uses a dynamic path from the profile when enabled", async () => {
    saveProfile(demoProfile);
    const result = await mimicProtocol.test(
      makeRequest({ profile: "unit", dynamicPath: true }),
    );
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("dynamic path");
    expect(result.detail).toMatch(/\/(api|news)\//);
  });

  it("errors clearly when the profile does not exist", async () => {
    const result = await mimicProtocol.test(makeRequest({ profile: "nope" }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("unknown profile");
  });

  it("carries the ciphertext in the URL query when secretIn=query", async () => {
    saveProfile({
      ...demoProfile,
      name: "q",
      request: {
        secretField: "pass",
        secretIn: "query",
        fields: [{ name: "locale", value: "zh_CN" }],
      },
    });
    const result = await mimicProtocol.test(makeRequest({ profile: "q" }));
    expect(result.ok).toBe(true);
  });

  it("carries the ciphertext in a header when secretIn=header", async () => {
    saveProfile({
      ...demoProfile,
      name: "h",
      request: {
        secretField: "pass",
        secretIn: "header",
        fields: [{ name: "csrftoken", value: "{{hex:16}}" }],
      },
    });
    const result = await mimicProtocol.test(makeRequest({ profile: "h" }));
    expect(result.ok).toBe(true);
  });

  it("accepts an array of request shapes and rotates", async () => {
    saveProfile({
      ...demoProfile,
      name: "rot",
      request: [
        { secretField: "pass", fields: [] },
        { secretField: "pass", secretIn: "query", fields: [] },
        { secretField: "pass", secretIn: "header", fields: [] },
      ],
    });
    // three modes x a few runs — all must round-trip whichever shape was picked
    for (let i = 0; i < 6; i++) {
      const result = await mimicProtocol.test(makeRequest({ profile: "rot" }));
      expect(result.ok).toBe(true);
    }
  });

  it("round-trips with aes-cbc + padTail + html-comment markers", async () => {
    await server.close();
    server = await startMimicServer({
      cipher: { algorithm: "aes-cbc", encoding: "base64", padTail: true, marker: "html-comment" },
    });
    saveProfile({
      ...demoProfile,
      name: "cbc",
      cipher: { algorithm: "aes-cbc", encoding: "base64", padTail: true, marker: "html-comment" },
    });
    const test = await mimicProtocol.test(makeRequest({ profile: "cbc" }));
    expect(test.ok).toBe(true);
    const exec = await mimicProtocol.exec!(makeRequest({ profile: "cbc" }), "echo cbc-canary-7");
    expect(exec.ok).toBe(true);
    expect(exec.output).toContain("cbc-canary-7");
  });

  it("round-trips with xor + hex encoding", async () => {
    await server.close();
    server = await startMimicServer({ cipher: { algorithm: "xor", encoding: "hex" } });
    saveProfile({ ...demoProfile, name: "xor", cipher: { algorithm: "xor", encoding: "hex" } });
    const result = await mimicProtocol.test(makeRequest({ profile: "xor" }));
    expect(result.ok).toBe(true);
  });

  it("fails cleanly when client and server ciphers disagree", async () => {
    saveProfile({ ...demoProfile, name: "mismatch", cipher: { algorithm: "aes-cbc" } });
    // server still speaks the legacy default
    const result = await mimicProtocol.test(makeRequest({ profile: "mismatch" }));
    expect(result.ok).toBe(false);
  });
});

describe("mimic-shared wire format", () => {
  it("derives a per-shell left marker", () => {
    expect(deriveLeftMarker("pass", "key")).toMatch(/^var Re[0-9a-f]{5}_config="$/);
    expect(deriveLeftMarker("pass", "key")).not.toBe(deriveLeftMarker("other", "key"));
  });

  it("injects the script before </body> and keeps the page valid", () => {
    const html = "<html><body>skin</body></html>";
    const out = injectIntoTemplate(html, "QUJD", 'var Reabc12_config="');
    expect(out).toBe('<html><body>skin<script>var Reabc12_config="QUJD";</script></body></html>');
  });

  it("builds the form body with decoy fields and renders {{hex:N}}", () => {
    const body = encodeRequestBody("verCode", Buffer.from("id"), deriveAesKey("key"), [
      { name: "csrftoken", value: "{{hex:32}}" },
      { name: "j_username", value: "admin" },
    ]).toString();
    const params = new URLSearchParams(body);
    expect(params.get("csrftoken")).toMatch(/^[0-9a-f]{32}$/);
    expect(params.get("j_username")).toBe("admin");
    expect(params.get("pass")).toBeNull();
    // the ciphertext round-trips through the secret field
    expect(decryptField(params.get("verCode")!, deriveAesKey("key")).toString()).toBe("id");
  });

  it("renders {{hex:N}} deterministically in shape and leaves plain text alone", () => {
    expect(renderFieldValue("{{hex:8}}")).toMatch(/^[0-9a-f]{8}$/);
    expect(renderFieldValue("on")).toBe("on");
    expect(renderFieldValue("a{{hex:4}}b")).toMatch(/^a[0-9a-f]{4}b$/);
  });
});
