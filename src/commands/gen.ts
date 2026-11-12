import { readFileSync } from "node:fs";

import { Command, Option } from "commander";

import { createClient, type GlobalOptions, logInfo } from "../cli-context.js";
import { logOp } from "../core/oplog.js";
import { emitSinglePackResult, hasMultiplePackResults } from "../core/output.js";
import { buildMemShellRequest, type MemShellOptions } from "../core/request-builder.js";
import { parseObfuscationOptions } from "../core/obfuscation.js";
import { agentLoadExamples, supportsAgentLoadArguments } from "../core/agent.js";
import { runMemShellWizard } from "../wizard/memshell-wizard.js";
import {
  parseShellToolConfig,
  parseToolConfigFile,
} from "../core/shell-tool-config.js";

interface GenCmdOptions extends GlobalOptions {
  server?: string;
  serverVersion?: string;
  tool?: string;
  type?: string;
  packer?: string;
  jdk?: string;
  debug?: boolean;
  bypassModule?: boolean;
  shrink?: boolean;
  lambdaSuffix?: boolean;
  probe?: boolean;
  obfuscate?: boolean;
  obfuscationOptions?: string;
  obfuscationScope?: "ALL" | "MEMSHELL_INJECTOR" | "INJECTOR" | "MEMSHELL";
  shellClassName?: string;
  toolOption?: string[];
  toolConfig?: string;
  godzillaPass?: string;
  godzillaKey?: string;
  behinderPass?: string;
  antswordPass?: string;
  commandParamName?: string;
  commandTemplate?: string;
  encryptor?: string;
  implementationClass?: string;
  headerName?: string;
  headerValue?: string;
  shellClassBase64?: string;
  shellClassFile?: string;
  urlPattern?: string;
  injectorClassName?: string;
  staticInitialize?: boolean;
  output?: string;
  decode?: boolean;
  json?: boolean;
  interactive?: boolean;
  agentArgs?: string;
}

const REQUIRED = ["server", "tool", "type", "packer"] as const;

async function toOptions(o: GenCmdOptions, client: ReturnType<typeof createClient>): Promise<MemShellOptions> {
  let shellClassBase64 = o.shellClassBase64;
  if (o.shellClassFile) {
    shellClassBase64 = readFileSync(o.shellClassFile).toString("base64");
  }
  const hasPluginOptions = (o.toolOption?.length ?? 0) > 0 || o.toolConfig !== undefined;
  const toolConfigs = hasPluginOptions ? await client.getShellToolConfigs() : [];
  const shellToolParams = hasPluginOptions
    ? toolConfigs.find((config) => config.tool === o.tool)?.params
    : undefined;
  const fromFile = o.toolConfig === undefined
    ? {}
    : parseToolConfigFile(
        o.toolConfig.trimStart().startsWith("{")
          ? o.toolConfig
          : readFileSync(o.toolConfig, "utf8"),
        shellToolParams,
      );
  const shellToolConfig = {
    ...fromFile,
    ...parseShellToolConfig(o.toolOption, shellToolParams),
  };
  return {
    server: o.server!,
    serverVersion: o.serverVersion,
    shellTool: o.tool!,
    shellType: o.type!,
    packer: o.packer!,
    jdk: o.jdk,
    debug: o.debug,
    byPassJavaModule: o.bypassModule,
    shrink: o.shrink,
    lambdaSuffix: o.lambdaSuffix,
    probe: o.probe,
    obfuscate: o.obfuscate,
    obfuscationOptions: parseObfuscationOptions(o.obfuscationOptions),
    obfuscationScope: o.obfuscationScope,
    shellClassName: o.shellClassName,
    shellToolConfig: hasPluginOptions ? shellToolConfig : undefined,
    shellToolParams,
    godzillaPass: o.godzillaPass,
    godzillaKey: o.godzillaKey,
    behinderPass: o.behinderPass,
    antSwordPass: o.antswordPass,
    commandParamName: o.commandParamName,
    commandTemplate: o.commandTemplate,
    encryptor: o.encryptor,
    implementationClass: o.implementationClass,
    headerName: o.headerName,
    headerValue: o.headerValue,
    shellClassBase64,
    urlPattern: o.urlPattern,
    injectorClassName: o.injectorClassName,
    staticInitialize: o.staticInitialize,
  };
}

export function registerGenCommand(program: Command): void {
  program
    .command("gen")
    .alias("generate")
    .description("Generate a memory shell. Runs an interactive wizard when required flags are missing.")
    .option("-s, --server <server>", "target server, e.g. Tomcat")
    .option("--server-version <v>", "target server version")
    .option("-t, --tool <tool>", "shell tool, e.g. Godzilla, Behinder, Command")
    .option("-y, --type <type>", "shell type, e.g. Listener, Filter, Servlet")
    .option("-p, --packer <packer>", "packer, e.g. Base64, Jar, JSP")
    .option("--jdk <version>", "target JDK: java6/8/9/11/17/21/25, or a class-file major version")
    .option("--debug", "enable debug output in the payload")
    .option("--bypass-module", "bypass Java module restrictions")
    .option("--no-shrink", "disable bytecode shrinking (enabled by default)")
    .option("--lambda-suffix", "append a lambda class-name suffix")
    .option("--probe", "use echo/probe mode")
    .option("--obfuscate", "enable class obfuscation (MemShellParty v3+)")
    .option("--obfuscation-options <options>", "obfuscation overrides: key=value, comma-separated")
    .addOption(
      new Option("--obfuscation-scope <scope>", "obfuscation scope (MemShellParty v3+)").choices([
        "ALL",
        "MEMSHELL_INJECTOR",
        "INJECTOR",
        "MEMSHELL",
      ]),
    )
    .option("--shell-class-name <name>", "explicit shell class name (random if omitted)")
    .option(
      "--tool-option <name=value>",
      "shell-tool-specific option; repeat for multiple fields; object values use JSON (v3.1+)",
      (value, previous: string[] = []) => [...previous, value],
      [],
    )
    .option("--tool-config <json|path>", "shell-tool options as a JSON object or a JSON file path")
    .option("--godzilla-pass <pass>", "Godzilla / GodzillaSession password")
    .option("--godzilla-key <key>", "Godzilla / GodzillaSession key")
    .option("--behinder-pass <pass>", "Behinder password")
    .option("--antsword-pass <pass>", "AntSword password")
    .option("--command-param-name <name>", "Command tool parameter name")
    .option("--command-template <tpl>", "Command template ({command} placeholder)")
    .option("--encryptor <name>", "Command encryptor")
    .option("--implementation-class <name>", "Command implementation class")
    .option("--header-name <name>", "auth header name")
    .option("--header-value <value>", "auth header value")
    .option("--shell-class-base64 <b64>", "custom shell class (base64) for the Custom tool")
    .option("--shell-class-file <path>", "custom shell .class file for the Custom tool")
    .option("--url-pattern <pattern>", "injector URL pattern")
    .option("--injector-class-name <name>", "explicit injector class name")
    .option("--no-static-initialize", "disable injector static initialization (enabled by default)")
    .option("--agent-args <args>", "Agent load-time arguments, e.g. persist=true or restore=true (not sent to the generate API)")
    .option("-o, --output <file>", "write payload to a file instead of stdout")
    .addOption(new Option("--decode", "base64-decode the payload before writing"))
    .addOption(new Option("--no-decode", "do not base64-decode the payload"))
    .option("--json", "print the full JSON response instead of just the payload (with -o the file is still written and the JSON gains an outputFile field)")
    .option("-i, --interactive", "force the interactive wizard")
    .option("--no-interactive", "never launch the wizard; error on missing flags")
    .addHelpText(
      "after",
      `
Examples:
  $ memparty gen                                  # interactive wizard
  $ memparty gen -s Tomcat -t Godzilla -y Listener -p DefaultBase64 \\
      --godzilla-pass pass --godzilla-key key --jdk java8
  $ memparty gen -s Tomcat -t Godzilla -y Listener -p DefaultBase64 \\
      --godzilla-pass pass --godzilla-key key -o shell.class
  $ memparty gen -s Tomcat -t Command -y Filter -p DefaultBase64 \\
      --command-param-name cmd --encryptor RAW --implementation-class RuntimeExec
  $ memparty gen -s Tomcat -t Godzilla -y Listener -p DefaultBase64 --json
  $ memparty gen -s Tomcat -t Godzilla -y AgentFilterChain -p AgentJar --agent-args persist=true
  $ memparty gen -s Tomcat -t PluginTool -y Filter -p DefaultBase64 \\
      --tool-option profile='{"id":"web-1","name":"Web"}' --tool-option mode=fast

Note: run 'memparty config' to list the available servers, tools, shell
types and packers. On v3, parent packers are categories — pick a concrete
variant (e.g. DefaultBase64 instead of Base64). Legacy v2 backends still
support aggregate packers, but -o cannot write several variants to one file.
The --json output includes the gate header (shellToolConfig) you need for
'memparty connect' / 'memparty exec'.
Use 'memparty config tool-configs' to discover plugin string, enum and object
fields. --tool-config can be an inline JSON object or a path to a JSON file.
Repeated --tool-option values override matching keys from --tool-config.
`,
    )
    .action(async (opts: GenCmdOptions, cmd: Command) => {
      const client = createClient(cmd.optsWithGlobals());

      const missing = REQUIRED.filter((k) => !opts[k]);
      const stdinIsTty = Boolean(process.stdin.isTTY);
      const wantWizard =
        opts.interactive === true ||
        (opts.interactive !== false && missing.length > 0 && stdinIsTty);

      let memOpts: MemShellOptions;
      if (wantWizard) {
        memOpts = await runMemShellWizard(client);
      } else {
        if (missing.length > 0) {
          throw new Error(
            `Missing required option(s): ${missing.map((m) => `--${m}`).join(", ")}. ` +
              `Run in a terminal for the wizard, or pass -i.`,
          );
        }
        memOpts = await toOptions(opts, client);
      }

      const request = buildMemShellRequest(memOpts);
      const { agentArgs } = opts;
      if (agentArgs !== undefined && !supportsAgentLoadArguments(memOpts.shellType, memOpts.packer)) {
        throw new Error(
          "--agent-args requires an Agent* shell type " +
            "and an AgentJar, AgentJarWithJDKAttacher, or AgentJarWithJREAttacher packer.",
        );
      }
      // safe summary for the op log — parameters only, never credentials
      const genMeta = {
        server: memOpts.server,
        serverVersion: memOpts.serverVersion,
        shellTool: memOpts.shellTool,
        shellType: memOpts.shellType,
        packer: memOpts.packer,
        jdk: memOpts.jdk,
      };
      const started = Date.now();
      let response;
      try {
        response = await client.generateMemShell(request);
      } catch (err) {
        logOp({
          category: "gen",
          action: "gen",
          ok: false,
          durationMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
          meta: genMeta,
        });
        throw err;
      }
      logOp({
        category: "gen",
        action: "gen",
        ok: true,
        durationMs: Date.now() - started,
        detail: `${response.memShellResult.shellClassName} (${response.memShellResult.shellSize} bytes)`,
        meta: genMeta,
      });

      if (opts.json) {
        // -o still writes the payload file in JSON mode; the JSON document
        // then carries an extra `outputFile` field with the write result.
        const outputFile =
          opts.output !== undefined
            ? emitSinglePackResult(response, { outFile: opts.output, decode: opts.decode })
            : undefined;
        const doc = {
          ...response,
          ...(outputFile === undefined ? {} : { outputFile }),
          ...(agentArgs === undefined ? {} : { agentArgs, agentLoadExamples: agentLoadExamples(agentArgs) }),
        };
        process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
        return;
      }

      const r = response.memShellResult;
      logInfo(`shell class:    ${r.shellClassName} (${r.shellSize} bytes)`);
      logInfo(`injector class: ${r.injectorClassName} (${r.injectorSize} bytes)`);

      if (hasMultiplePackResults(response)) {
        if (opts.output !== undefined) {
          throw new Error(
            `-o cannot write ${Object.keys(response.allPackResults!).length} packer variants to one file. ` +
              `Pick a leaf packer instead (see 'memparty config packers', e.g. DefaultBase64).`,
          );
        }
        for (const [name, value] of Object.entries(response.allPackResults!)) {
          logInfo(`\n=== ${name} ===`);
          process.stdout.write(`${value}\n`);
        }
        return;
      }

      const result = emitSinglePackResult(response, {
        outFile: opts.output,
        decode: opts.decode,
      });
      if (result.destination !== "stdout") {
        logInfo(`wrote ${result.size} bytes to ${result.destination}${result.decoded ? " (base64-decoded)" : ""}`);
      }
      if (agentArgs !== undefined) {
        for (const example of agentLoadExamples(agentArgs)) logInfo(`load: ${example}`);
      }
    });
}
