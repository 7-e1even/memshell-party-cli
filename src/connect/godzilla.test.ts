import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { aesEcbDecrypt, aesEcbEncrypt, gunzipLenient, gzip, md5Hex, md5Key16 } from "./crypto.js";
import { execGodzilla, testGodzilla } from "./godzilla.js";

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
  basicsInfoCalls: number;
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

      // payload class upload: define it, hand out a session cookie
      if (data.readUInt32BE(0) === 0xcafebabe) {
        state.payloadLoaded = true;
        res.setHeader("Set-Cookie", "JSESSIONID=abc123; Path=/");
        return fail();
      }
      if (!state.payloadLoaded) return fail();

      if (req.headers.cookie?.includes("JSESSIONID=abc123")) {
        state.sawCookieOnSecondRequest = true;
      }

      const params = parseSerialized(gunzipLenient(data));
      const method = params.get("methodName")?.toString();
      const reply = (out: string) => {
        const wrapped =
          WRAP.slice(0, 16) +
          aesEcbEncrypt(gzip(Buffer.from(out)), XC).toString("base64") +
          WRAP.slice(16);
        res.writeHead(200).end(wrapped);
      };

      if (method === "test") return reply("ok");
      if (method === "getBasicsInfo") {
        state.basicsInfoCalls++;
        const osName = req.url === "/godzilla-linux" ? "Linux" : "Windows 10";
        return reply(`OsInfo : os.name: ${osName} os.version: 1 os.arch: amd64\n`);
      }
      if (method === "execCommand") {
        const n = Number(params.get("argsCount")?.toString() ?? "0");
        const argv: string[] = [];
        for (let i = 0; i < n; i++) argv.push(params.get(`arg-${i}`)?.toString() ?? "");
        return reply(`MOCK-EXEC:${argv.join(" ")}`);
      }
      return fail();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

describe("testGodzilla", () => {
  let server: Server;
  let base: string;
  const state: MockState = { payloadLoaded: false, sawCookieOnSecondRequest: false, basicsInfoCalls: 0 };

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

describe("execGodzilla", () => {
  let server: Server;
  let base: string;
  const state: MockState = { payloadLoaded: false, sawCookieOnSecondRequest: false, basicsInfoCalls: 0 };

  beforeAll(async () => {
    server = await startMock(state);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("wraps the command in cmd.exe on auto-detected Windows", async () => {
    const result = await execGodzilla(`${base}/godzilla`, "pass", "key", "whoami", {
      headerValue: GATE,
    });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("MOCK-EXEC:cmd.exe /c whoami");
  });

  it("wraps the command in /bin/sh on auto-detected Linux", async () => {
    const result = await execGodzilla(`${base}/godzilla-linux`, "pass", "key", "id", {
      headerValue: GATE,
    });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("MOCK-EXEC:/bin/sh -c id");
  });

  it("skips OS detection when os is given explicitly", async () => {
    state.basicsInfoCalls = 0;
    const result = await execGodzilla(`${base}/godzilla`, "pass", "key", "id", {
      headerValue: GATE,
      os: "linux",
    });
    expect(result.ok).toBe(true);
    expect(result.output).toBe("MOCK-EXEC:/bin/sh -c id");
    expect(state.basicsInfoCalls).toBe(0);
  });

  it("fails with a wrong key", async () => {
    const result = await execGodzilla(`${base}/godzilla`, "pass", "wrong", "id", {
      headerValue: GATE,
      os: "linux",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("fails without the gate header", async () => {
    const result = await execGodzilla(`${base}/godzilla`, "pass", "key", "id", { os: "linux" });
    expect(result.ok).toBe(false);
  });
});
