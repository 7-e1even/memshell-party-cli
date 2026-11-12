import { readFileSync } from "node:fs";

import { checkbox, confirm, input, select } from "@inquirer/prompts";

import { JDK_VERSIONS } from "../core/jdk.js";
import type { MemShellOptions } from "../core/request-builder.js";
import type { MemPartyClient } from "../api/client.js";
import type { ShellToolConfigValue, ToolConfigDescriptor, ToolConfigParam } from "../api/types.js";
import { fetchRemoteOptions, toolConfigForTool } from "../core/shell-tool-config.js";

const JDK_CHOICES = [
  { name: "server default", value: "" },
  ...Object.entries(JDK_VERSIONS).map(([name, major]) => ({
    name: `${name} (${major})`,
    value: name,
  })),
];

/** Drive an interactive prompt flow, returning options for buildMemShellRequest. */
export async function runMemShellWizard(client: MemPartyClient): Promise<MemShellOptions> {
  const [config, packerTree, toolConfigs] = await Promise.all([
    client.getConfig(),
    client.getPackerTree(),
    client.getShellToolConfigs(),
  ]);

  const server = await select({
    message: "Target server",
    choices: Object.keys(config).map((s) => ({ name: s, value: s })),
  });

  const tools = Object.keys(config[server]);
  const shellTool = await select({
    message: "Shell tool",
    choices: tools.map((t) => ({ name: t, value: t })),
  });

  const shellType = await select({
    message: "Shell type",
    choices: config[server][shellTool].map((t) => ({ name: t, value: t })),
  });

  const category = await select({
    message: "Packer category",
    choices: packerTree.map((packer) => ({ name: packer.name, value: packer.name })),
  });
  const selected = packerTree.find((packer) => packer.name === category)!;
  const packer = selected.children.length
    ? await select({
        message: "Packer variant",
        choices: selected.children.map((name) => ({ name, value: name })),
      })
    : category;

  const opts: MemShellOptions = { server, shellTool, shellType, packer };

  const toolConfig = toolConfigForTool(toolConfigs, shellTool);
  if (toolConfig) {
    opts.shellToolParams = toolConfig.params;
    opts.shellToolConfig = {};
    const visibleParams = toolConfig.params.filter((param) => param.ui?.kind === "remote-select" || !useRandomDefaults(toolConfig));
    const singleRemoteParam = visibleParams.length === 1 && visibleParams[0]?.ui?.kind === "remote-select"
      ? visibleParams[0]
      : undefined;
    for (const param of visibleParams) {
      const value = await promptToolParam(param, param.name === singleRemoteParam?.name);
      if (value !== undefined && value !== "") opts.shellToolConfig[param.name] = value;
    }
  } else {
    await promptLegacyToolConfig(opts, client);
  }

  const shellClassName = await input({ message: "Shell class name (optional, random if empty)", default: "" });
  if (shellClassName) opts.shellClassName = shellClassName;

  opts.urlPattern = await input({ message: "URL pattern", default: "/*" });

  const jdk = await select({ message: "Target JDK", choices: JDK_CHOICES });
  if (jdk) opts.jdk = jdk;

  const toggles = await checkbox({
    message: "Options",
    choices: [
      { name: "shrink bytecode", value: "shrink", checked: true },
      { name: "static initialize", value: "staticInitialize", checked: true },
      { name: "bypass Java module", value: "byPassJavaModule" },
      { name: "lambda suffix", value: "lambdaSuffix" },
      { name: "debug", value: "debug" },
      { name: "class obfuscation (v3+)", value: "obfuscate" },
    ],
  });
  opts.shrink = toggles.includes("shrink");
  opts.staticInitialize = toggles.includes("staticInitialize");
  opts.byPassJavaModule = toggles.includes("byPassJavaModule");
  opts.lambdaSuffix = toggles.includes("lambdaSuffix");
  opts.debug = toggles.includes("debug");
  opts.obfuscate = toggles.includes("obfuscate");

  const confirmed = await confirm({ message: `Generate ${shellTool} ${shellType} for ${server} (${packer})?` });
  if (!confirmed) {
    throw new Error("Cancelled by user.");
  }

  return opts;
}

async function promptToolParam(param: ToolConfigParam, autoSelectFirst = false): Promise<ShellToolConfigValue | undefined> {
  const label = param.label || param.name;
  if (param.ui?.kind === "remote-select") {
    const defaultSource = process.env[param.ui.urlQueryParam] ?? "";
    const sourceUrl = defaultSource || await input({
      message: `${label}: remote options URL (${param.ui.urlQueryParam})${param.ui.required ? "" : " (optional)"}`,
      default: defaultSource,
    });
    if (!sourceUrl) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const options = await fetchRemoteOptions(
        sourceUrl,
        param.ui,
        param.type === "object",
        globalThis.fetch,
        controller.signal,
      );
      if (options.length === 0) throw new Error(`No remote options returned for ${param.name}.`);
      if (autoSelectFirst) return options[0]!.value;
      const selected = await select({
        message: label,
        choices: options.map((option, index) => ({ name: option.label, value: String(index) })),
      });
      return options[Number(selected)]!.value;
    } finally {
      clearTimeout(timer);
    }
  }
  if (param.type === "object") {
    const raw = await input({ message: `${label} (JSON object, optional)`, default: "" });
    if (!raw) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (err) {
      throw new Error(`${param.name} must be valid JSON: ${(err as Error).message}`);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${param.name} must be a JSON object.`);
    }
    return value as Record<string, unknown>;
  }
  if (param.type === "enum") {
    return select({
      message: label,
      choices: [
        { name: `backend default${param.placeholder ? ` (${param.placeholder})` : ""}`, value: "" },
        ...param.options.map((option) => ({ name: option, value: option })),
      ],
    });
  }
  if (param.name === "shellClassBase64") {
    const file = await input({ message: "Path to custom .class file" });
    return file ? readFileSync(file).toString("base64") : undefined;
  }
  return input({ message: label, default: "", ...(param.placeholder ? { placeholder: param.placeholder } : {}) });
}

function useRandomDefaults(config: ToolConfigDescriptor): boolean {
  return ["Godzilla", "GodzillaSession", "Behinder", "AntSword"].includes(config.tool);
}

async function promptLegacyToolConfig(
  opts: MemShellOptions,
  client: MemPartyClient,
): Promise<void> {
  switch (opts.shellTool) {
    case "Godzilla":
    case "GodzillaSession":
      opts.godzillaPass = await input({ message: "Godzilla pass", default: "pass" });
      opts.godzillaKey = await input({ message: "Godzilla key", default: "key" });
      break;
    case "Behinder":
      opts.behinderPass = await input({ message: "Behinder pass", default: "rebeyond" });
      break;
    case "AntSword":
      opts.antSwordPass = await input({ message: "AntSword pass", default: "ant" });
      break;
    case "Command": {
      opts.commandParamName = await input({ message: "Command param name", default: "cmd" });
      const commandConfig = await client.getCommandConfigs();
      opts.encryptor = await select({
        message: "Encryptor",
        choices: commandConfig.encryptors.map((value) => ({ name: value, value })),
      });
      opts.implementationClass = await select({
        message: "Implementation class",
        choices: commandConfig.implementationClasses.map((value) => ({ name: value, value })),
      });
      const template = await input({ message: "Command template (optional, {command} placeholder)", default: "" });
      if (template) opts.commandTemplate = template;
      break;
    }
    case "Custom": {
      const file = await input({ message: "Path to custom .class file" });
      opts.shellClassBase64 = readFileSync(file).toString("base64");
      break;
    }
  }
  opts.headerName = await input({ message: "Header name", default: "User-Agent" });
  const headerValue = await input({ message: "Header value (optional)", default: "" });
  if (headerValue) opts.headerValue = headerValue;
}
