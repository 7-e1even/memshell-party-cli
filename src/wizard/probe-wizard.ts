import { checkbox, confirm, input, select } from "@inquirer/prompts";

import type { MemPartyClient } from "../api/client.js";
import { JDK_VERSIONS } from "../core/jdk.js";
import type { ProbeOptions } from "../core/request-builder.js";

const JDK_CHOICES = [
  { name: "server default", value: "" },
  ...Object.entries(JDK_VERSIONS).map(([name, major]) => ({ name: `${name} (${major})`, value: name })),
];

const PROBE_METHODS = ["ResponseBody", "ResponseHeader", "DNSLog", "Sleep"];
const PROBE_CONTENTS = {
  ResponseBody: ["Server", "Command", "Bytecode", "ScriptEngine", "Filter"],
  ResponseHeader: ["Server", "Command", "Bytecode", "ScriptEngine", "Filter"],
  DNSLog: ["Server", "JDK"],
  Sleep: ["Server"],
};

export async function runProbeWizard(client: MemPartyClient): Promise<ProbeOptions> {
  const [packerTree, discoveredServers, config] = await Promise.all([
    client.getPackerTree(),
    client.getProbeResponseServers(),
    client.getConfig(),
  ]);
  const servers = discoveredServers.length ? discoveredServers : Object.keys(config);

  const probeMethod = await select({
    message: "Probe method",
    choices: PROBE_METHODS.map((m) => ({ name: m, value: m })),
  });

  const probeContent = await select({
    message: "Probe content",
    choices: PROBE_CONTENTS[probeMethod as keyof typeof PROBE_CONTENTS].map((content) => ({
      name: content,
      value: content,
    })),
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

  const opts: ProbeOptions = { probeMethod, probeContent, packer };

  switch (probeMethod) {
    case "DNSLog":
      opts.host = await input({ message: "DNSLog host" });
      break;
    case "Sleep":
      opts.sleepServer = await select({
        message: "Sleep server",
        choices: servers.map((s) => ({ name: s, value: s })),
      });
      opts.seconds = Number(await input({ message: "Seconds", default: "5" }));
      break;
    case "ResponseBody":
    case "ResponseHeader":
      opts.server = await select({
        message: "Server",
        choices: servers.map((s) => ({ name: s, value: s })),
      });
      opts.reqParamName = await input({ message: "Request param/header name", default: "cmd" });
      opts.commandTemplate = await input({
        message: "Command template (optional, {command} placeholder)",
        default: "",
      });
      if (probeMethod === "ResponseHeader") {
        opts.respHeaderName = await input({ message: "Response header name (optional)", default: "" });
      }
      break;
    default:
      break;
  }

  const shellClassName = await input({ message: "Shell class name (optional)", default: "" });
  if (shellClassName) opts.shellClassName = shellClassName;

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

  const confirmed = await confirm({ message: `Generate ${probeMethod} probe (${packer})?` });
  if (!confirmed) throw new Error("Cancelled by user.");

  return opts;
}
