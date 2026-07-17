import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { MemPartyClient } from "../api/client.js";
import { testBehinder } from "../connect/behinder.js";
import { testGodzilla } from "../connect/godzilla.js";
import { testSuo5 } from "../connect/suo5.js";
import type { ConnectTestResult } from "../connect/types.js";
import { buildMemShellRequest } from "../core/request-builder.js";
import { buildProbeRequest } from "../core/request-builder.js";
import { CLI_VERSION } from "../version.js";

function jsonContent(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorContent(err: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
  };
}

const memShellInput = {
  server: z.string().describe("Target server, e.g. Tomcat"),
  serverVersion: z.string().optional(),
  shellTool: z.string().describe("Shell tool, e.g. Godzilla, Behinder, Command"),
  shellType: z.string().describe("Shell type, e.g. Listener, Filter, Servlet"),
  packer: z.string().describe("Packer, e.g. Base64, Jar, JSP"),
  jdk: z.string().optional().describe("java6/8/9/11/17/21 or class-file major version"),
  debug: z.boolean().optional(),
  byPassJavaModule: z.boolean().optional(),
  shrink: z.boolean().optional(),
  lambdaSuffix: z.boolean().optional(),
  probe: z.boolean().optional(),
  shellClassName: z.string().optional(),
  godzillaPass: z.string().optional(),
  godzillaKey: z.string().optional(),
  behinderPass: z.string().optional(),
  antSwordPass: z.string().optional(),
  commandParamName: z.string().optional(),
  commandTemplate: z.string().optional(),
  encryptor: z.string().optional(),
  implementationClass: z.string().optional(),
  headerName: z.string().optional(),
  headerValue: z.string().optional(),
  shellClassBase64: z.string().optional(),
  urlPattern: z.string().optional(),
  injectorClassName: z.string().optional(),
  staticInitialize: z.boolean().optional(),
};

const probeInput = {
  probeMethod: z.enum(["ResponseBody", "DNSLog", "Sleep"]),
  probeContent: z.string().describe("BasicInfo, Server, OS, JDK, Bytecode, Command"),
  packer: z.string(),
  jdk: z.string().optional(),
  debug: z.boolean().optional(),
  byPassJavaModule: z.boolean().optional(),
  shrink: z.boolean().optional(),
  lambdaSuffix: z.boolean().optional(),
  staticInitialize: z.boolean().optional(),
  shellClassName: z.string().optional(),
  host: z.string().optional(),
  seconds: z.number().optional(),
  sleepServer: z.string().optional(),
  server: z.string().optional(),
  reqParamName: z.string().optional(),
  commandTemplate: z.string().optional(),
};

const connectInput = {
  url: z.string().describe("URL of the deployed shell"),
  tool: z.enum(["godzilla", "behinder", "suo5"]).describe("shell tool to test"),
  pass: z
    .string()
    .optional()
    .describe("password (godzilla default: pass; behinder default: rebeyond)"),
  key: z.string().optional().describe("godzilla key (default: key)"),
  headerName: z
    .string()
    .optional()
    .describe("gate header name from generate_memshell shellToolConfig (usually User-Agent)"),
  headerValue: z
    .string()
    .optional()
    .describe("gate header value from generate_memshell shellToolConfig — required for MemShellParty shells"),
  suo5Mode: z
    .enum(["auto", "v2", "v1"])
    .optional()
    .describe("suo5 protocol variant (default: auto)"),
  insecure: z.boolean().optional().describe("skip TLS certificate verification"),
  timeoutMs: z.number().optional().describe("request timeout in milliseconds (default 30000)"),
};

export function createMcpServer(client: MemPartyClient): McpServer {
  const server = new McpServer({ name: "memshell-party", version: CLI_VERSION });

  server.registerTool(
    "list_servers",
    { title: "List servers", description: "List supported servers and their shell types" },
    async () => {
      try {
        return jsonContent(await client.getServers());
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "list_config",
    {
      title: "List full config",
      description: "List every server's shell tools and their supported shell types",
    },
    async () => {
      try {
        return jsonContent(await client.getConfig());
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "list_packers",
    { title: "List packers", description: "List packers as a parent/child tree" },
    async () => {
      try {
        return jsonContent(await client.getPackerTree());
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "list_command_configs",
    {
      title: "List command configs",
      description: "List Command-tool encryptors and implementation classes",
    },
    async () => {
      try {
        return jsonContent(await client.getCommandConfigs());
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "generate_memshell",
    { title: "Generate memory shell", description: "Generate a Java memory shell payload", inputSchema: memShellInput },
    async (args) => {
      try {
        const response = await client.generateMemShell(buildMemShellRequest(args));
        return jsonContent(response);
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "generate_probe",
    { title: "Generate probe shell", description: "Generate a probe/detection shell payload", inputSchema: probeInput },
    async (args) => {
      try {
        const response = await client.generateProbe(buildProbeRequest(args));
        return jsonContent(response);
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "parse_classname",
    {
      title: "Parse class name",
      description: "Parse the fully-qualified class name from base64-encoded .class bytes",
      inputSchema: { classBase64: z.string().describe("base64-encoded .class file bytes") },
    },
    async ({ classBase64 }) => {
      try {
        return jsonContent({ className: await client.parseClassName(classBase64) });
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "server_version",
    { title: "Server version", description: "Get the backend server version info" },
    async () => {
      try {
        return jsonContent(await client.getVersion());
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "connect_test",
    {
      title: "Test shell connection",
      description:
        "Test whether a deployed Godzilla / Behinder / suo5 shell is alive and the " +
        "credentials work, by performing the tool's real protocol handshake. " +
        "Pass the gate header (headerName/headerValue) from generate_memshell output for MemShellParty shells.",
      inputSchema: connectInput,
    },
    async (args) => {
      try {
        const common = {
          headerName: args.headerName,
          headerValue: args.headerValue,
          timeoutMs: args.timeoutMs,
          insecure: args.insecure,
        };
        let result: ConnectTestResult;
        switch (args.tool) {
          case "godzilla":
            result = await testGodzilla(args.url, args.pass ?? "pass", args.key ?? "key", common);
            break;
          case "behinder":
            result = await testBehinder(args.url, args.pass ?? "rebeyond", common);
            break;
          case "suo5":
            result = await testSuo5(args.url, { ...common, mode: args.suo5Mode });
            break;
        }
        return jsonContent(result);
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  return server;
}

/** Start the MCP server over stdio. */
export async function startMcpStdio(client: MemPartyClient): Promise<void> {
  const server = createMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
