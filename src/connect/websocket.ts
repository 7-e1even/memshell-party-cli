import WebSocket from "ws";

import { buildHeaders, type CommonConnectOptions } from "./types.js";

export function isWebSocketUrl(url: string): boolean {
  return /^wss?:\/\//i.test(url);
}

export function requestWebSocket(
  url: string,
  body: Buffer,
  options: CommonConnectOptions = {},
): Promise<Buffer> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return Promise.reject(new Error(`invalid WebSocket URL: ${url}`));
  }
  if (target.protocol !== "ws:" && target.protocol !== "wss:") {
    return Promise.reject(new Error(`unsupported WebSocket protocol: ${target.protocol}`));
  }
  const timeoutMs = options.timeoutMs ?? 30_000;

  return new Promise<Buffer>((resolve, reject) => {
    const socket = new WebSocket(target, {
      headers: buildHeaders({}, options),
      handshakeTimeout: timeoutMs,
      rejectUnauthorized: !options.insecure,
      perMessageDeflate: false,
      maxPayload: 256 * 1024 * 1024,
    });
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    const finish = (error?: Error, result?: Buffer) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      socket.removeAllListeners();
      if (error) reject(error);
      else resolve(result!);
      socket.close();
    };
    timer = setTimeout(() => finish(new Error(`WebSocket request timed out after ${timeoutMs}ms`)), timeoutMs);

    socket.once("open", () => socket.send(body));
    socket.on("message", (data: Buffer, isBinary: boolean) => {
      // `ws` reassembles transport fragments before emitting a message. The
      // Godzilla endpoint keeps the connection open after its binary reply.
      finish(isBinary ? undefined : new Error("expected a binary Godzilla WebSocket response"), data);
    });
    socket.once("close", () => finish(new Error("WebSocket closed without a response")));
    socket.once("error", (error) => finish(error));
    socket.once("unexpected-response", (_request, response) => {
      finish(new Error(`WebSocket handshake failed: HTTP ${response.statusCode ?? 0}`));
    });
  });
}
