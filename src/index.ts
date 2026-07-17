/**
 * Library entrypoint — re-exports the reusable API client, types, and
 * request/output helpers so this package can be consumed programmatically,
 * not only as a CLI.
 */
export * from "./api/index.js";
export {
  buildMemShellRequest,
  buildProbeRequest,
  type MemShellOptions,
  type ProbeOptions,
} from "./core/request-builder.js";
export { emitPayload, shouldDecode, type OutputOptions, type OutputResult } from "./core/output.js";
export { resolveApiUrl, DEFAULT_API_URL, ENV_VAR } from "./core/config.js";
export { resolveJreVersion, JDK_VERSIONS } from "./core/jdk.js";
export { createMcpServer, startMcpStdio } from "./mcp/server.js";
export { testBehinder, type BehinderConnectOptions } from "./connect/behinder.js";
export { testGodzilla } from "./connect/godzilla.js";
export {
  testSuo5,
  marshalSuo5Map,
  unmarshalSuo5Map,
  marshalFrameBase64,
  unmarshalFrameBase64,
  type Suo5ConnectOptions,
  type Suo5Mode,
} from "./connect/suo5.js";
export type {
  CommonConnectOptions,
  ConnectTestResult,
  ConnectTool,
} from "./connect/types.js";
export { CLI_VERSION } from "./version.js";
