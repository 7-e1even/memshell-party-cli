import { Command } from "commander";

import { createClient, type GlobalOptions } from "../cli-context.js";
import { fetchRemoteOptions } from "../core/shell-tool-config.js";

interface ConfigCmdOptions extends GlobalOptions {
  json?: boolean;
}

interface RemoteOptionsCmdOptions extends ConfigCmdOptions {
  url?: string;
  object?: boolean;
}

function printJsonOrLines(data: unknown, json: boolean | undefined, renderLines: () => string[]): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderLines().join("\n")}\n`);
  }
}

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("Query supported servers, shell tools, shell types, and packers")
    .addHelpText(
      "after",
      `
Examples:
  $ memparty config servers          # servers + their shell types (values for gen -s)
  $ memparty config tools Tomcat     # tools available on one server (values for gen -t)
  $ memparty config packers          # packer tree (values for gen -p)
  $ memparty config command          # Command-tool encryptors and impl classes
  $ memparty config tool-configs     # v3+ tool parameter names and enum values
  $ memparty config obfuscation     # v3+ obfuscation option reference
  $ memparty config plugins         # v3.1+ external plugin metadata and load status
  $ memparty config remote-options PluginTool target --url https://example.com/options
`,
    );

  config
    .command("servers")
    .description("List supported servers and their shell types")
    .option("--json", "output raw JSON")
    .action(async (opts: ConfigCmdOptions, cmd: Command) => {
      const client = createClient(cmd.optsWithGlobals());
      const servers = await client.getServers();
      printJsonOrLines(servers, opts.json, () =>
        Object.entries(servers).map(([name, types]) => `${name}\n  ${types.join(", ")}`),
      );
    });

  config
    .command("tools")
    .description("List shell tools (and their shell types) per server")
    .argument("[server]", "filter by a single server name")
    .option("--json", "output raw JSON")
    .action(async (server: string | undefined, opts: ConfigCmdOptions, cmd: Command) => {
      const client = createClient(cmd.optsWithGlobals());
      const config = await client.getConfig();
      const filtered = server ? { [server]: config[server] ?? {} } : config;
      printJsonOrLines(filtered, opts.json, () =>
        Object.entries(filtered).flatMap(([name, tools]) => [
          name,
          ...Object.entries(tools).map(([tool, types]) => `  ${tool}: ${types.join(", ")}`),
        ]),
      );
    });

  config
    .command("packers")
    .description("List packers (parent / child tree)")
    .option("--json", "output raw JSON")
    .action(async (opts: ConfigCmdOptions, cmd: Command) => {
      const client = createClient(cmd.optsWithGlobals());
      const tree = await client.getPackerTree();
      printJsonOrLines(tree, opts.json, () =>
        tree.map((p) => (p.children.length ? `${p.name}\n  ${p.children.join(", ")}` : p.name)),
      );
    });

  config
    .command("tool-configs")
    .description("List shell tool parameters (empty for v2 backends)")
    .option("--json", "output raw JSON")
    .action(async (opts: ConfigCmdOptions, cmd: Command) => {
      const client = createClient(cmd.optsWithGlobals());
      const configs = await client.getShellToolConfigs();
      printJsonOrLines(configs, opts.json, () =>
        configs.length
          ? configs.flatMap((config) => [
              config.tool,
              ...config.params.map(
                (param) =>
                  `  ${param.name} (${param.type})${param.options.length ? `: ${param.options.join(", ")}` : ""}${param.ui?.kind === "remote-select" ? ` [remote: ${param.ui.urlQueryParam}${param.ui.required ? ", required" : ""}]` : ""}`,
              ),
            ])
          : ["No v3 shell-tool config endpoint on this backend."],
      );
    });

  config
    .command("plugins")
    .description("List external plugin metadata and load status (MemShellParty v3.1+)")
    .option("--json", "output raw JSON")
    .action(async (opts: ConfigCmdOptions, cmd: Command) => {
      const client = createClient(cmd.optsWithGlobals());
      const plugins = await client.getPlugins();
      printJsonOrLines(plugins, opts.json, () =>
        plugins.length
          ? plugins.flatMap((plugin) => [
              `${plugin.name}${plugin.version ? ` (${plugin.version})` : ""} [${plugin.loaded ? "loaded" : "not loaded"}]`,
              `  jar: ${plugin.jarFileName}`,
              ...(plugin.author ? [`  author: ${plugin.author}`] : []),
              ...(plugin.description ? [`  description: ${plugin.description}`] : []),
              ...(plugin.homepage ? [`  homepage: ${plugin.homepage}`] : []),
              ...(plugin.license ? [`  license: ${plugin.license}`] : []),
              ...(plugin.source ? [`  source: ${plugin.source}`] : []),
              ...(plugin.spiServices.length ? [`  SPI: ${plugin.spiServices.join(", ")}`] : []),
              ...(plugin.loadError ? [`  load error: ${plugin.loadError}`] : []),
            ])
          : ["No external plugins (or the backend predates v3.1)."],
      );
    });

  config
    .command("remote-options")
    .description("Resolve a v3.1 remote-select field into string IDs or complete objects")
    .argument("<tool>", "shell tool name")
    .argument("<param>", "remote-select parameter name")
    .option("--url <url>", "remote JSON endpoint (or set the field's urlQueryParam as an env var)")
    .option("--object", "return complete objects instead of using the parameter's declared type")
    .option("--json", "output raw JSON")
    .action(async (tool: string, paramName: string, opts: RemoteOptionsCmdOptions, cmd: Command) => {
      const client = createClient(cmd.optsWithGlobals());
      const descriptor = (await client.getShellToolConfigs()).find((config) => config.tool === tool);
      const param = descriptor?.params.find((candidate) => candidate.name === paramName);
      if (!param?.ui || param.ui.kind !== "remote-select") {
        throw new Error(`${tool}.${paramName} is not a remote-select shell tool option.`);
      }
      const sourceUrl = opts.url ?? process.env[param.ui.urlQueryParam];
      if (!sourceUrl) {
        throw new Error(`Provide --url or set the ${param.ui.urlQueryParam} environment variable.`);
      }
      const options = await fetchRemoteOptions(sourceUrl, param.ui, opts.object ?? param.type === "object");
      printJsonOrLines(options, opts.json, () => options.map((option, index) => {
        const value = typeof option.value === "string" ? option.value : JSON.stringify(option.value);
        return `${index}: ${option.label} => ${value}`;
      }));
    });

  config
    .command("obfuscation")
    .description("List obfuscation options (MemShellParty v3+)")
    .option("--json", "output raw JSON")
    .action(async (opts: ConfigCmdOptions, cmd: Command) => {
      const client = createClient(cmd.optsWithGlobals());
      const options = await client.getObfuscationOptions();
      printJsonOrLines(options, opts.json, () =>
        options.map((option) =>
          Object.entries(option)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join(" "),
        ),
      );
    });

  config
    .command("command")
    .description("List Command-tool encryptors and implementation classes")
    .option("--json", "output raw JSON")
    .action(async (opts: ConfigCmdOptions, cmd: Command) => {
      const client = createClient(cmd.optsWithGlobals());
      const cc = await client.getCommandConfigs();
      printJsonOrLines(cc, opts.json, () => [
        `encryptors: ${cc.encryptors.join(", ")}`,
        `implementationClasses: ${cc.implementationClasses.join(", ")}`,
      ]);
    });
}
