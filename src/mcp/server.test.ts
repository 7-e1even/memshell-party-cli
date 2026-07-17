import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemPartyClient } from "../api/client.js";
import { aesEcbDecrypt, aesEcbEncrypt, md5Key16 } from "../connect/crypto.js";
import { readStringConstant } from "../connect/classfile.js";
import { createMcpServer } from "./server.js";

const GATE = "mcp-gate";
const BH_KEY = md5Key16("rebeyond");

/** Tiny Behinder mock (same protocol as connect/behinder.test.ts). */
function startBehinderMock(): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const fail = () => res.writeHead(200).end();
      if (!(req.headers["user-agent"] ?? "").includes(GATE)) return fail();
      let classBytes: Buffer;
      try {
        classBytes = aesEcbDecrypt(
          Buffer.from(Buffer.concat(chunks).toString("latin1").trim(), "base64"),
          BH_KEY,
        );
      } catch {
        return fail();
      }
      const content = readStringConstant(classBytes, "content") ?? "";
      const json = JSON.stringify({
        status: Buffer.from("success").toString("base64"),
        msg: Buffer.from(content).toString("base64"),
      });
      res.writeHead(200).end(Buffer.from(aesEcbEncrypt(Buffer.from(json), BH_KEY).toString("base64")));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}

describe("MCP connect_test tool", () => {
  let httpServer: Server;
  let base: string;
  let mcpClient: Client;

  beforeAll(async () => {
    httpServer = await startBehinderMock();
    base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

    const apiClient = new MemPartyClient({ baseUrl: "http://unused" });
    const mcpServer = createMcpServer(apiClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    mcpClient = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([mcpClient.connect(clientTransport), mcpServer.connect(serverTransport)]);
  });

  afterAll(async () => {
    await mcpClient.close();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  it("lists connect_test with its input schema", async () => {
    const { tools } = await mcpClient.listTools();
    const tool = tools.find((t) => t.name === "connect_test");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("protocol handshake");
    const props = (tool!.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(["url", "tool", "pass", "key", "headerName", "headerValue"]),
    );
  });

  it("reports ok=true for a working shell", async () => {
    const result = (await mcpClient.callTool({
      name: "connect_test",
      arguments: {
        url: `${base}/behinder`,
        tool: "behinder",
        pass: "rebeyond",
        headerValue: GATE,
      },
    })) as ToolResult;
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.ok).toBe(true);
    expect(payload.tool).toBe("behinder");
  });

  it("reports ok=false for a wrong password (not a protocol error)", async () => {
    const result = (await mcpClient.callTool({
      name: "connect_test",
      arguments: {
        url: `${base}/behinder`,
        tool: "behinder",
        pass: "wrongpass",
        headerValue: GATE,
      },
    })) as ToolResult;
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBeTruthy();
  });
});
