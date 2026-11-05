import { readFileSync } from "node:fs";

import { Command, Option } from "commander";

import type { BytecodeTransformRequest } from "../api/types.js";
import { createClient, logInfo, type GlobalOptions } from "../cli-context.js";
import { emitPayload, emitSinglePackResult } from "../core/output.js";
import { parseObfuscationOptions } from "../core/obfuscation.js";

interface BytecodeInputOptions extends GlobalOptions {
  file?: string;
  json?: boolean;
}

interface TransformOptions extends BytecodeInputOptions {
  packer?: string;
  bypassModule?: boolean;
  staticInitialize?: boolean;
  shrink?: boolean;
  renamePackage?: boolean;
  relocateFrom?: string;
  relocateTo?: string;
  entryMethod?: string;
  newClassName?: string;
  randomName?: boolean;
  obfuscate?: boolean;
  obfuscationOptions?: string;
  server?: string;
  probeMethod?: "ResponseBody" | "ResponseHeader";
  respHeaderName?: string;
  output?: string;
}

function classInput(base64: string | undefined, file: string | undefined): string {
  if (file !== undefined && base64 !== undefined) {
    throw new Error("Pass either a Base64 argument or --file, not both.");
  }
  if (file !== undefined) return readFileSync(file).toString("base64");
  if (base64 !== undefined) return base64;
  if (process.stdin.isTTY) {
    throw new Error("Provide Base64 as an argument, --file <path>, or Base64 on stdin.");
  }
  return readFileSync(0, "utf8");
}

export function buildBytecodeTransformRequest(base64: string, opts: TransformOptions): BytecodeTransformRequest {
  const renamePackage = opts.renamePackage || opts.relocateFrom !== undefined || opts.relocateTo !== undefined;
  if (renamePackage && (!opts.relocateFrom || !opts.relocateTo)) {
    throw new Error("Package relocation requires both --relocate-from and --relocate-to.");
  }
  const obfuscation = opts.obfuscate || opts.obfuscationOptions !== undefined
    ? { enabled: true, options: parseObfuscationOptions(opts.obfuscationOptions) }
    : undefined;
  return {
    classBytesBase64: base64,
    ...(opts.packer === undefined ? {} : { packer: opts.packer }),
    ...(opts.bypassModule === undefined ? {} : { byPassJavaModule: opts.bypassModule }),
    ...(opts.staticInitialize === undefined ? {} : { staticInitialize: opts.staticInitialize }),
    ...(opts.shrink === undefined ? {} : { shrink: opts.shrink }),
    ...(renamePackage ? { renamePackage, relocateFrom: opts.relocateFrom, relocateTo: opts.relocateTo } : {}),
    ...(opts.entryMethod === undefined ? {} : { entryMethod: opts.entryMethod }),
    ...(opts.newClassName === undefined ? {} : { newClassName: opts.newClassName }),
    ...(opts.randomName === undefined ? {} : { randomName: opts.randomName }),
    ...(obfuscation === undefined ? {} : { obfuscation }),
    ...(opts.probeMethod === undefined ? {} : {
      server: opts.server ?? "Unknown",
      probe: {
        probeMethod: opts.probeMethod,
        probeContent: "Bytecode",
        respHeaderName: opts.respHeaderName,
      },
    }),
  };
}

export function registerBytecodeCommand(program: Command): void {
  const command = program.command("bytecode").description("Decode and transform arbitrary Java classes (MemShellParty v3+)");

  command
    .command("decode")
    .description("Decode Base64/GzipBase64 class bytes and print class metadata")
    .argument("[base64]", "Base64/GzipBase64 class bytes (omit when using --file or stdin)")
    .option("-f, --file <path>", "read a .class file from disk")
    .option("--json", "print the full JSON response")
    .addHelpText("after", "\nExamples:\n  $ memparty bytecode decode -f Payload.class\n  $ cat Payload.class | memparty bytecode decode --json\n")
    .action(async (base64: string | undefined, opts: BytecodeInputOptions, cmd: Command) => {
      const client = createClient(cmd.optsWithGlobals());
      const result = await client.decodeBytecode(classInput(base64, opts.file));
      if (opts.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else process.stdout.write(`${result.className} (${result.size} bytes)\n${result.classBytesBase64Str}\n`);
    });

  command
    .command("transform")
    .description("Rename, relocate, instrument, obfuscate or pack a class")
    .argument("[base64]", "Base64/GzipBase64 class bytes (omit when using --file or stdin)")
    .option("-f, --file <path>", "read a .class file from disk")
    .option("-p, --packer <packer>", "packer, e.g. DefaultBase64, JSP")
    .option("--bypass-module", "bypass Java module restrictions")
    .option("--static-initialize", "call the no-argument constructor from a static initializer")
    .option("--no-shrink", "keep bytecode debug information")
    .option("--rename-package", "enable package relocation")
    .option("--relocate-from <prefix>", "original package prefix, e.g. javax.servlet")
    .option("--relocate-to <prefix>", "replacement package prefix, e.g. jakarta.servlet")
    .option("--entry-method <signature>", "add an entry method, e.g. 'public static void main(String[] args)'")
    .option("--new-class-name <name>", "new simple or fully-qualified class name")
    .option("--random-name", "generate a random class and package name")
    .option("--obfuscate", "enable class obfuscation")
    .option("--obfuscation-options <options>", "obfuscation overrides: key=value, comma-separated")
    .option("--server <server>", "response-wrapper server (default: Unknown)")
    .addOption(new Option("--probe-method <method>", "embed a Bytecode response wrapper").choices(["ResponseBody", "ResponseHeader"]))
    .option("--resp-header-name <name>", "ResponseHeader response header (random when omitted)")
    .option("-o, --output <file>", "write the packed result, or the transformed class when no packer is given")
    .option("--json", "print the full JSON response; outputFile is added when -o is used")
    .addHelpText("after", "\nExamples:\n  $ memparty bytecode transform -f Payload.class --relocate-from javax.servlet --relocate-to jakarta.servlet -o JakartaPayload.class\n  $ memparty bytecode transform -f Payload.class --entry-method 'public static void main(String[] args)' -o Entry.class\n  $ memparty bytecode transform -f Payload.class --server Tomcat --probe-method ResponseHeader -p DefaultBase64 -o Probe.class --json\n")
    .action(async (base64: string | undefined, opts: TransformOptions, cmd: Command) => {
      const client = createClient(cmd.optsWithGlobals());
      const request = buildBytecodeTransformRequest(classInput(base64, opts.file), opts);
      const result = await client.transformBytecode(request);
      const outputFile = opts.output === undefined
        ? undefined
        : result.packResult !== undefined
          ? emitSinglePackResult(result, { outFile: opts.output })
          : emitPayload(result.classBytesBase64Str, { outFile: opts.output, decode: true });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(outputFile === undefined ? result : { ...result, outputFile }, null, 2)}\n`);
        return;
      }
      logInfo(`class: ${result.className} (${result.size} bytes)`);
      if (outputFile !== undefined) {
        logInfo(`wrote ${outputFile.size} bytes to ${outputFile.destination}`);
      } else if (result.packResult !== undefined) {
        emitSinglePackResult(result, {});
      } else {
        process.stdout.write(`${result.classBytesBase64Str}\n`);
      }
    });
}
