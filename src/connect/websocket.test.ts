import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { aesEcbDecrypt, aesEcbEncrypt, gunzipLenient, gzip, md5Key16, md5Hex } from "./crypto.js";
import { testGodzilla } from "./godzilla.js";

const PASS = "pass";
const KEY = "key";
const XC = md5Key16(KEY);
const GATE = "websocket-gate";
const SESSION = "JSESSIONID=abc123";

function methodName(data: Buffer): string {
  const plain = gunzipLenient(data);
  const prefix = Buffer.from("methodName");
  if (!plain.subarray(0, prefix.length).equals(prefix)) return "";
  const length = plain.readUInt32LE(prefix.length + 1);
  return plain.subarray(prefix.length + 5, prefix.length + 5 + length).toString("utf8");
}

describe("Godzilla transports", () => {
  let server: Server;
  let sockets: WebSocketServer;
  let base: string;
  let wsUrl: string;
  let sawCookie = false;
  let missingCookieRejected = false;
  let upgradeRequests = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => res.writeHead(400).end());
    sockets = new WebSocketServer({ noServer: true, perMessageDeflate: false });
    let payloadLoaded = false;
    sockets.on("connection", (socket, request) => {
      if (!request.headers["user-agent"]?.includes(GATE)) {
        socket.close();
        return;
      }
      socket.on("message", (message: Buffer) => {
        try {
          const plain = aesEcbDecrypt(message, XC);
          if (plain.length > 4 && plain.readUInt32BE(0) === 0xcafebabe) {
            payloadLoaded = true;
            socket.send(aesEcbEncrypt(Buffer.from("ok"), XC));
            socket.close();
            return;
          }
          if (!payloadLoaded || methodName(plain) !== "test") {
            socket.send(Buffer.from("bad"));
            socket.close();
            return;
          }
          const response = aesEcbEncrypt(gzip(Buffer.from("ok")), XC);
          socket.send(response);
        } catch {
          socket.send(Buffer.from("bad"));
        }
      });
    });
    server.on("upgrade", (request, socket, head) => {
      if (request.headers.upgrade !== "websocket") {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          upgradeRequests++;
          const params = new URLSearchParams(Buffer.concat(chunks).toString());
          const encrypted = params.get(PASS);
          if (!encrypted || !request.headers["user-agent"]?.includes(GATE)) {
            socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
            return;
          }
          const plain = aesEcbDecrypt(Buffer.from(encrypted, "base64"), XC);
          if (plain.length > 4 && plain.readUInt32BE(0) === 0xcafebabe) {
            socket.end(`HTTP/1.1 200 OK\r\nSet-Cookie: ${SESSION}; Path=/\r\nContent-Length: 0\r\n\r\n`);
            return;
          }
          if (!request.headers.cookie?.includes(SESSION) || methodName(plain) !== "test") {
            missingCookieRejected = true;
            socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
            return;
          }
          sawCookie = true;
          const mark = md5Hex(PASS + XC).toUpperCase();
          const body = mark.slice(0, 16) + aesEcbEncrypt(gzip(Buffer.from("ok")), XC).toString("base64") + mark.slice(16);
          socket.end(`HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
        });
        return;
      }
      sockets.handleUpgrade(request, socket, head, (client) => sockets.emit("connection", client, request));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    wsUrl = base.replace(/^http/, "ws");
  });

  afterAll(async () => {
    sockets.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("uploads over WebSocket and accepts an encrypted reply on a persistent connection", async () => {
    const result = await testGodzilla(`${wsUrl}/ws/shell`, PASS, KEY, { headerValue: GATE });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  });

  it("fails clearly for incorrect WebSocket credentials", async () => {
    const result = await testGodzilla(`${wsUrl}/ws/shell`, PASS, "wrong", { headerValue: GATE });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/wrong key|decrypt/);
  });

  it("preserves transport errors instead of reporting them as decryption failures", async () => {
    const result = await testGodzilla(`${wsUrl}/ws/shell`, PASS, KEY, {
      headerValue: "wrong-gate",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/closed without a response/);
    expect(result.error).not.toMatch(/decrypt/);
  });

  it("uses Upgrade headers on every HTTP request and requires the session cookie", async () => {
    const result = await testGodzilla(`${base}/upgrade`, PASS, KEY, {
      headerValue: GATE,
      upgradeProtocol: "org.example.UpgradeShell",
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(upgradeRequests).toBe(2);
    expect(sawCookie).toBe(true);
    expect(missingCookieRejected).toBe(false);
  });
});
