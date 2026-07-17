import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { testBehinder } from "./behinder.js";
import { readStringConstant } from "./classfile.js";
import { aesEcbDecrypt, aesEcbEncrypt, md5Key16 } from "./crypto.js";

const GATE = "bh-gate-value";
const KEY = md5Key16("rebeyond"); // e45e329feb5d925b

function echoReply(classBytes: Buffer, rawWithMagic: boolean): Buffer {
  const content = readStringConstant(classBytes, "content") ?? "";
  const json = JSON.stringify({
    status: Buffer.from("success").toString("base64"),
    msg: Buffer.from(content).toString("base64"),
  });
  const encrypted = aesEcbEncrypt(Buffer.from(json, "utf8"), KEY);
  if (rawWithMagic) {
    const magic = parseInt(KEY.slice(0, 2), 16) % 16;
    return Buffer.concat([encrypted, Buffer.alloc(magic, 0x55)]);
  }
  return Buffer.from(encrypted.toString("base64"));
}

function startMock(): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const fail = () => res.writeHead(200).end();
      const ua = req.headers["user-agent"] ?? "";
      if (!ua.includes(GATE)) return fail();

      // Behinder shell: base64(AES(class)) or raw AES(class)
      let classBytes: Buffer | null = null;
      try {
        classBytes = aesEcbDecrypt(Buffer.from(body.toString("latin1").trim(), "base64"), KEY);
      } catch {
        try {
          classBytes = aesEcbDecrypt(body, KEY);
        } catch {
          classBytes = null;
        }
      }
      if (!classBytes || classBytes.readUInt32BE(0) !== 0xcafebabe) return fail();

      const raw = req.url === "/behinder-raw";
      res.writeHead(200).end(echoReply(classBytes, raw));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

describe("testBehinder", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = await startMock();
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("verifies the echo round-trip with the right password", async () => {
    const result = await testBehinder(`${base}/behinder`, "rebeyond", { headerValue: GATE });
    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/echo verified \(\d+ random bytes/);
  });

  it("handles raw AES responses with a magic suffix", async () => {
    const result = await testBehinder(`${base}/behinder-raw`, "rebeyond", {
      headerValue: GATE,
    });
    expect(result.ok).toBe(true);
  });

  it("fails with a wrong password", async () => {
    const result = await testBehinder(`${base}/behinder`, "wrongpass", { headerValue: GATE });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("wrong password");
  });

  it("fails without the gate header", async () => {
    const result = await testBehinder(`${base}/behinder`, "rebeyond");
    expect(result.ok).toBe(false);
  });

  it("reports network errors", async () => {
    const result = await testBehinder("http://127.0.0.1:1/x", "rebeyond", { timeoutMs: 2000 });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
