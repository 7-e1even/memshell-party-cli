import { writeFileSync } from "node:fs";

/** File extensions whose payload is base64-encoded bytes and should be decoded. */
const BINARY_EXTENSIONS = [".class", ".jar", ".zip", ".ser", ".bin"];

export interface OutputOptions {
  /** Destination file path. When omitted, content goes to stdout. */
  outFile?: string;
  /** Force base64 decoding before writing (binary payload). */
  decode?: boolean;
}

export interface OutputResult {
  /** Where the payload went: a file path, or "stdout". */
  destination: string;
  /** Number of bytes written (file) or characters printed (stdout). */
  size: number;
  /** Whether the payload was base64-decoded. */
  decoded: boolean;
}

function hasBinaryExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return BINARY_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Decide whether a payload should be base64-decoded before writing.
 * Explicit `decode` wins; otherwise infer from the output file extension.
 */
export function shouldDecode(opts: OutputOptions): boolean {
  if (opts.decode !== undefined) return opts.decode;
  if (opts.outFile) return hasBinaryExtension(opts.outFile);
  return false;
}

/**
 * Emit a payload string either to a file or to stdout.
 * Uses injectable sinks so it can be unit-tested without touching the real fs/stdout.
 */
export function emitPayload(
  payload: string,
  opts: OutputOptions,
  sinks: {
    writeFile?: (path: string, data: Buffer | string) => void;
    writeStdout?: (data: string) => void;
  } = {},
): OutputResult {
  const writeFile = sinks.writeFile ?? ((p, d) => writeFileSync(p, d));
  const writeStdout = sinks.writeStdout ?? ((d) => process.stdout.write(d));
  const decoded = shouldDecode(opts);

  if (opts.outFile) {
    if (decoded) {
      const buf = Buffer.from(payload, "base64");
      writeFile(opts.outFile, buf);
      return { destination: opts.outFile, size: buf.length, decoded: true };
    }
    writeFile(opts.outFile, payload);
    return { destination: opts.outFile, size: Buffer.byteLength(payload), decoded: false };
  }

  // stdout
  if (decoded) {
    const buf = Buffer.from(payload, "base64");
    writeStdout(buf.toString("binary"));
    return { destination: "stdout", size: buf.length, decoded: true };
  }
  writeStdout(payload.endsWith("\n") ? payload : `${payload}\n`);
  return { destination: "stdout", size: payload.length, decoded: false };
}

/** The subset of a generate response that carries the packed payload(s). */
export interface PackResultsShape {
  packResult?: string;
  allPackResults?: Record<string, string> | null;
}

/** True when the response holds several packer variants at once (aggregate packer). */
export function hasMultiplePackResults(r: PackResultsShape): boolean {
  return r.allPackResults != null && Object.keys(r.allPackResults).length > 0;
}

/**
 * Write a generate response's payload to a file/stdout, requiring a single
 * packed result. Throws a clear error when an aggregate packer returned
 * several variants (there is no single file to write) or none at all.
 */
export function emitSinglePackResult(
  r: PackResultsShape,
  opts: OutputOptions,
  sinks: {
    writeFile?: (path: string, data: Buffer | string) => void;
    writeStdout?: (data: string) => void;
  } = {},
): OutputResult {
  if (hasMultiplePackResults(r)) {
    const n = Object.keys(r.allPackResults!).length;
    throw new Error(
      `the aggregate packer returned ${n} variants at once — cannot write them to a single file. ` +
        `Pick a leaf packer instead (see 'memparty config packers', e.g. DefaultBase64).`,
    );
  }
  if (r.packResult === undefined) {
    throw new Error("Server returned no packResult.");
  }
  return emitPayload(r.packResult, opts, sinks);
}
