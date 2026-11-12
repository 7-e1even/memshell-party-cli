/**
 * Type definitions mirroring the MemShellParty backend DTOs.
 * Source of truth: memshell-party-{api,boot} (v3), with legacy v2 transport support.
 */

// ---------- Shared request pieces ----------

export interface ShellConfig {
  server: string;
  serverVersion?: string;
  shellTool: string;
  shellType: string;
  /** Java class-file major version, e.g. 50 (Java6), 52 (Java8), 61 (Java17). */
  targetJreVersion?: number;
  debug?: boolean;
  byPassJavaModule?: boolean;
  shrink?: boolean;
  lambdaSuffix?: boolean;
  /** v3 uses a ProbeConfig object; v2 used a boolean switch. */
  probe?: boolean | ProbeConfig;
  obfuscation?: ObfuscationConfig;
  obfuscationScope?: "ALL" | "MEMSHELL_INJECTOR" | "INJECTOR" | "MEMSHELL";
}

export type ShellToolConfigObject = Record<string, unknown>;
export type ShellToolConfigValue = string | ShellToolConfigObject;

export interface ShellToolConfig {
  [key: string]: ShellToolConfigValue | undefined;
  shellClassName?: string;
  pass?: string;
  key?: string;
  paramName?: string;
  template?: string;
  /** @deprecated MemShellParty v2 request field. */
  godzillaPass?: string;
  /** @deprecated MemShellParty v2 request field. */
  godzillaKey?: string;
  /** @deprecated MemShellParty v2 request field. */
  commandParamName?: string;
  /** @deprecated MemShellParty v2 request field. */
  commandTemplate?: string;
  /** @deprecated MemShellParty v2 request field. */
  behinderPass?: string;
  /** @deprecated MemShellParty v2 request field. */
  antSwordPass?: string;
  headerName?: string;
  headerValue?: string;
  shellClassBase64?: string;
  encryptor?: string;
  implementationClass?: string;
}

export interface InjectorConfig {
  injectorClassName?: string;
  urlPattern?: string;
  staticInitialize?: boolean;
}

export interface ObfuscationConfig {
  enabled?: boolean;
  options?: Record<string, unknown>;
}

export interface MemShellGenerateRequest {
  shellConfig: ShellConfig;
  shellToolConfig: ShellToolConfig;
  injectorConfig: InjectorConfig;
  /** Packer name, e.g. "Base64", "Jar", "JSP". */
  packer: string;
}

// ---------- Shared response pieces ----------

export interface MemShellResult {
  shellClassName: string;
  shellSize: number;
  shellBytesBase64Str: string;
  injectorClassName: string;
  injectorSize: number;
  injectorBytesBase64Str: string;
  shellConfig: ShellConfig;
  shellToolConfig: ShellToolConfig;
  injectorConfig: InjectorConfig;
}

export interface MemShellGenerateResponse {
  memShellResult: MemShellResult;
  packResult?: string;
  allPackResults?: Record<string, string>;
}

// ---------- Probe ----------

export type ProbeMethod = "ResponseBody" | "ResponseHeader" | "DNSLog" | "Sleep";
export type ProbeContent = "BasicInfo" | "Server" | "OS" | "JDK" | "Bytecode" | "Command" | "ScriptEngine" | "Filter";

export interface ProbeConfig {
  probeMethod: string;
  probeContent: string;
  shellClassName?: string;
  respHeaderName?: string;
  targetJreVersion?: number;
  debug?: boolean;
  byPassJavaModule?: boolean;
  shrink?: boolean;
  staticInitialize?: boolean;
  lambdaSuffix?: boolean;
  obfuscation?: ObfuscationConfig;
}

export interface ProbeContentConfig {
  host?: string;
  seconds?: number;
  sleepServer?: string;
  server?: string;
  reqParamName?: string;
  commandTemplate?: string;
  respHeaderName?: string;
}

export interface ProbeShellGenerateRequest {
  probeConfig: ProbeConfig;
  probeContentConfig: ProbeContentConfig;
  packer: string;
}

export interface ProbeShellResult {
  shellClassName: string;
  shellSize: number;
  shellBytesBase64Str: string;
  probeConfig: ProbeConfig;
  probeContentConfig: ProbeContentConfig;
}

export interface ProbeShellGenerateResponse {
  probeShellResult: ProbeShellResult;
  packResult?: string;
  allPackResults?: Record<string, string>;
}

// ---------- Bytecode tools ----------

export interface BytecodeResult {
  className: string;
  size: number;
  classBytesBase64Str: string;
}

export interface BytecodeTransformRequest {
  classBytesBase64: string;
  packer?: string;
  byPassJavaModule?: boolean;
  staticInitialize?: boolean;
  shrink?: boolean;
  renamePackage?: boolean;
  relocateFrom?: string;
  relocateTo?: string;
  entryMethod?: string;
  newClassName?: string;
  randomName?: boolean;
  obfuscation?: ObfuscationConfig;
  server?: string;
  probe?: ProbeConfig | null;
}

export interface BytecodeTransformResponse extends BytecodeResult {
  packResult?: string;
}

// ---------- Config endpoints ----------

/** server name -> supported shell types */
export type ServerConfig = Record<string, string[]>;

/** server name -> { shell tool -> supported shell types } */
export type MainConfig = Record<string, Record<string, string[]>>;

export interface PackerOption {
  name: string;
  children: string[];
}
export type PackerTree = PackerOption[];

export interface CommandConfigVO {
  encryptors: string[];
  implementationClasses: string[];
}

export interface ToolConfigParam {
  name: string;
  type: "string" | "enum" | "object";
  options: string[];
  group?: string;
  label?: string;
  placeholder?: string;
  ui?: RemoteSelectUiHint;
}

export interface ToolConfigDescriptor {
  tool: string;
  params: ToolConfigParam[];
}

export type ObfuscationOption = Record<string, unknown>;

export interface RemoteSelectUiHint {
  kind: "remote-select";
  urlQueryParam: string;
  itemsPath: string;
  labelPath: string;
  valuePath?: string;
  required: boolean;
}

export interface PluginDescriptor {
  jarFileName: string;
  name: string;
  version?: string | null;
  author?: string | null;
  description?: string | null;
  homepage?: string | null;
  license?: string | null;
  source?: string | null;
  spiServices: string[];
  loaded: boolean;
  loadError?: string | null;
}

export interface VersionInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate?: boolean;
}

export interface ApiErrorResponse {
  error: string;
}
