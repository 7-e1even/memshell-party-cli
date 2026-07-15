import { Command } from "commander";

import { ApiError } from "./api/client.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerGenCommand } from "./commands/gen.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerParseClassNameCommand } from "./commands/parse-classname.js";
import { registerProbeCommand } from "./commands/probe.js";
import { registerVersionCommand } from "./commands/version.js";
import { DEFAULT_API_URL, ENV_VAR } from "./core/config.js";
import { CLI_VERSION } from "./version.js";

function buildProgram(): Command {
  const program = new Command();

  program
    .name("memparty")
    .description("CLI + MCP client for MemShellParty (party.mem.mk)")
    .version(CLI_VERSION, "-v, --version", "output the CLI version")
    .option(
      "--api <url>",
      `MemShellParty backend URL (env ${ENV_VAR}, default ${DEFAULT_API_URL})`,
    )
    .option("--timeout <ms>", "request timeout in milliseconds", "30000");

  registerGenCommand(program);
  registerProbeCommand(program);
  registerConfigCommand(program);
  registerParseClassNameCommand(program);
  registerVersionCommand(program);
  registerMcpCommand(program);

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    // Set exitCode rather than calling process.exit(): an abrupt exit while
    // undici's (global fetch) keep-alive socket is still open trips a libuv
    // assertion on Windows. Letting the event loop drain avoids the crash.
    if (err instanceof ApiError) {
      process.stderr.write(`API error (${err.status || "network"}): ${err.message}\n`);
      process.exitCode = 1;
    } else if (err instanceof Error) {
      // Inquirer throws this when the user aborts with Ctrl-C.
      if (err.name === "ExitPromptError") {
        process.stderr.write("\nAborted.\n");
        process.exitCode = 130;
      } else {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exitCode = 1;
      }
    } else {
      process.stderr.write(`Error: ${String(err)}\n`);
      process.exitCode = 1;
    }
  }
}

void main();
