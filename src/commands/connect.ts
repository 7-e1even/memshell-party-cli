import { Command, Option } from "commander";

import type { GlobalOptions } from "../cli-context.js";
import { testBehinder } from "../connect/behinder.js";
import { testGodzilla } from "../connect/godzilla.js";
import { testSuo5, type Suo5Mode } from "../connect/suo5.js";
import type { CommonConnectOptions, ConnectTestResult } from "../connect/types.js";

interface ConnectCmdOptions extends GlobalOptions {
  url?: string;
  tool?: string;
  pass?: string;
  key?: string;
  headerName?: string;
  headerValue?: string;
  header?: string[];
  suo5Mode?: Suo5Mode;
  insecure?: boolean;
  json?: boolean;
}

function parseExtraHeaders(lines: string[] | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of lines ?? []) {
    const idx = line.indexOf(":");
    if (idx <= 0) {
      throw new Error(`invalid header ${JSON.stringify(line)}, expected "Name: value"`);
    }
    headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return headers;
}

export function registerConnectCommand(program: Command): void {
  program
    .command("connect")
    .description(
      "Test whether a deployed webshell (Godzilla / Behinder / suo5) is alive and the credentials work",
    )
    .requiredOption("-u, --url <url>", "URL of the deployed shell")
    .addOption(
      new Option("-t, --tool <tool>", "shell tool").choices(["godzilla", "behinder", "suo5"]),
    )
    .option("--pass <pass>", "password (godzilla default: pass; behinder default: rebeyond)")
    .option("--key <key>", "godzilla key", "key")
    .option(
      "--header-name <name>",
      "gate header name reported by gen (shellToolConfig.headerName)",
    )
    .option(
      "--header-value <value>",
      "gate header value reported by gen (shellToolConfig.headerValue)",
    )
    .option("-H, --header <line...>", 'extra request header, e.g. -H "Cookie: a=b"')
    .addOption(
      new Option("--suo5-mode <mode>", "suo5 protocol variant")
        .choices(["auto", "v2", "v1"])
        .default("auto"),
    )
    .option("-k, --insecure", "skip TLS certificate verification")
    .option("--json", "output raw JSON")
    .action(async (opts: ConnectCmdOptions, cmd: Command) => {
      const globals = cmd.optsWithGlobals() as GlobalOptions & { timeout?: string };
      const timeoutMs = Number.parseInt(globals.timeout ?? "30000", 10);

      if (!opts.tool) {
        process.stderr.write("Error: --tool is required (godzilla | behinder | suo5)\n");
        process.exitCode = 1;
        return;
      }

      const common: CommonConnectOptions = {
        headerName: opts.headerName,
        headerValue: opts.headerValue,
        extraHeaders: parseExtraHeaders(opts.header),
        timeoutMs,
        insecure: opts.insecure,
      };

      let result: ConnectTestResult;
      switch (opts.tool) {
        case "godzilla":
          result = await testGodzilla(opts.url!, opts.pass ?? "pass", opts.key ?? "key", common);
          break;
        case "behinder":
          result = await testBehinder(opts.url!, opts.pass ?? "rebeyond", common);
          break;
        case "suo5":
          result = await testSuo5(opts.url!, { ...common, mode: opts.suo5Mode });
          break;
        default:
          process.stderr.write(`Error: unknown tool ${opts.tool}\n`);
          process.exitCode = 1;
          return;
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else if (result.ok) {
        process.stdout.write(`OK   ${result.tool} ${result.url}\n     ${result.detail ?? ""}\n`);
      } else {
        process.stderr.write(`FAIL ${result.tool} ${result.url}\n     ${result.error ?? ""}\n`);
      }
      if (!result.ok) {
        process.exitCode = 1;
      }
    });
}
