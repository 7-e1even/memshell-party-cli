import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { aesEcbDecrypt, aesEcbEncrypt, gunzipLenient, gzip, md5Hex, md5Key16 } from "./crypto.js";
import { testGodzilla } from "./godzilla.js";

const GATE = "gdz-gate-value";
const PASS = "pass";
const XC = md5Key16("key"); // 3c6e0b8a9c15224a
const WRAP = md5Hex(PASS + XC).toUpperCase();

/** Parse godzilla's `Parameter.serialize` stream (after gunzip). */
function parseSerialized(data: Buffer): Map<string, Buffer> {
  const map = new Map<string, Buffer>();
  let off = 0;
  let key: number[] = [];
  while (off < data.length) {
    const b = data[off]!;
    off++;
    if (b === 0x02) {
      const len = data.readUInt32LE(off);
      off += 4;
      map.set(Buffer.from(key).toString("utf8"), data.subarray(off, off + len));
      off += len;
      key = [];
    } else {
      key.push(b);
    }
  }
  return map;
}

interface MockState {
  payloadLoaded: boolean;
  sawCookieOnSecondRequest: boolean;
}

function startMock(state: MockState): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const fail = (text = "") => res.writeHead(200).end(text);
      const ua = req.headers["user-agent"] ?? "";
      if (!ua.includes(GATE)) return fail();

      const body = Buffer.concat(chunks).toString("utf8");
      let param: string | null = null;
      for (const pair of body.split("&")) {
        const i = pair.indexOf("=");
        if (i > 0 && pair.slice(0, i) === PASS) {
          param = decodeURIComponent(pair.slice(i + 1));
        }
      }
      if (param === null) return fail();

      let data: Buffer;
      try {
        data = aesEcbDecrypt(Buffer.from(param, "base64"), XC);
      } catch {
        // wrong key on a real shell: exception swallowed -> empty body
        return fail();
      }

      if (!state.payloadLoaded) {
        if (data.readUInt32BE(0) !== 0xcafebabe) return fail();
        state.payloadLoaded = true;
        res.setHeader("Set-Cookie", "JSESSIONID=abc123; Path=/");
        return fail();
      }

      if (req.headers.cookie?.includes("JSESSIONID=abc123")) {
        state.sawCookieOnSecondRequest = true;
      }

      const params = parseSerialized(gunzipLenient(data));
      if (params.get("methodName")?.toString() !== "test") return fail();
      const wrapped =
        WRAP.slice(0, 16) +
        aesEcbEncrypt(gzip(Buffer.from("ok")), XC).toString("base64") +
        WRAP.slice(16);
      res.writeHead(200).end(wrapped);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

describe("testGodzilla", () => {
  let server: Server;
  let base: string;
  const state: MockState = { payloadLoaded: false, sawCookieOnSecondRequest: false };

  beforeAll(async () => {
    server = await startMock(state);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("uploads the payload and verifies the test call", async () => {
    state.payloadLoaded = false;
    const result = await testGodzilla(`${base}/godzilla`, "pass", "key", { headerValue: GATE });
    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/"test" returned ok/);
  });

  it("relays the session cookie to the second request", () => {
    expect(state.sawCookieOnSecondRequest).toBe(true);
  });

  it("fails with a wrong key", async () => {
    state.payloadLoaded = false;
    const result = await testGodzilla(`${base}/godzilla`, "pass", "wrong", { headerValue: GATE });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("wrong pass/key");
  });

  it("fails with a wrong pass (wrapper mismatch)", async () => {
    state.payloadLoaded = false;
    const result = await testGodzilla(`${base}/godzilla`, "nope", "key", { headerValue: GATE });
    expect(result.ok).toBe(false);
  });

  it("fails without the gate header", async () => {
    state.payloadLoaded = false;
    const result = await testGodzilla(`${base}/godzilla`, "pass", "key");
    expect(result.ok).toBe(false);
  });

  it("reports network errors", async () => {
    const result = await testGodzilla("http://127.0.0.1:1/x", "pass", "key", { timeoutMs: 2000 });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
