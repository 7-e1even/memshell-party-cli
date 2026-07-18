/** Shared types for the shell connection testers. */

export type ConnectTool = "behinder" | "godzilla" | "suo5";

export interface ConnectTestResult {
  ok: boolean;
  tool: ConnectTool;
  url: string;
  /** Human-readable success detail (echo size, session id, protocol variant...). */
  detail?: string;
  /** Human-readable failure reason. */
  error?: string;
  durationMs: number;
}

export interface ExecResult {
  ok: boolean;
  tool: ConnectTool;
  url: string;
  /** The command line as executed remotely. */
  command: string;
  /** Decoded remote stdout+stderr (present on success). */
  output?: string;
  /** Human-readable failure reason. */
  error?: string;
  durationMs: number;
}

export interface CommonConnectOptions {
  /**
   * MemShellParty shells are gated by a header check:
   * the request must carry `headerName` containing `headerValue`
   * (both are reported by `memparty gen --json` as shellToolConfig).
   */
  headerName?: string;
  headerValue?: string;
  /** Extra request headers (already merged with the gate header). */
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
  insecure?: boolean;
}

/** Build the request headers for a tester: extra headers + gate header. */
export function buildHeaders(
  base: Record<string, string>,
  options: CommonConnectOptions,
): Record<string, string> {
  const headers = { ...base, ...options.extraHeaders };
  if (options.headerValue) {
    headers[options.headerName || "User-Agent"] = options.headerValue;
  }
  return headers;
}
