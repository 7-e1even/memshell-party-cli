import type {
  ApiErrorResponse,
  BytecodeResult,
  BytecodeTransformRequest,
  BytecodeTransformResponse,
  CommandConfigVO,
  MainConfig,
  MemShellGenerateRequest,
  MemShellGenerateResponse,
  ObfuscationOption,
  PackerTree,
  PluginDescriptor,
  ProbeShellGenerateRequest,
  ProbeShellGenerateResponse,
  ServerConfig,
  ToolConfigDescriptor,
  VersionInfo,
} from "./types.js";

export type FetchLike = typeof fetch;

/** Error thrown when the API responds with a non-2xx status. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface MemPartyClientOptions {
  /** Base URL of the MemShellParty backend, e.g. https://party.mem.mk */
  baseUrl: string;
  /** Injectable fetch implementation (defaults to global fetch). Useful for testing. */
  fetch?: FetchLike;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
}

/**
 * Typed client for the MemShellParty HTTP API.
 * Knows nothing about the CLI or MCP — it is a pure transport layer so every
 * entrypoint (flags, wizard, MCP) can share it.
 */
export class MemPartyClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private generationApiVersion?: Promise<"v2" | "v3">;

  constructor(options: MemPartyClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (typeof this.fetchImpl !== "function") {
      throw new Error(
        "No fetch implementation available. Use Node.js >= 18 or pass a custom fetch.",
      );
    }
  }

  // ---------- config ----------

  async getServers(): Promise<ServerConfig> {
    const config = await this.getConfig();
    return Object.fromEntries(
      Object.entries(config).map(([server, tools]) => [
        server,
        [...new Set(Object.values(tools).flat())],
      ]),
    );
  }

  getConfig(): Promise<MainConfig> {
    return this.request<MainConfig>("GET", "/api/config");
  }

  getPackerTree(): Promise<PackerTree> {
    return this.request<PackerTree>("GET", "/api/config/packers/tree");
  }

  async getPackers(): Promise<string[]> {
    try {
      return await this.request<string[]>("GET", "/api/config/packers");
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
      return (await this.getPackerTree()).map((packer) => packer.name);
    }
  }

  async getCommandConfigs(): Promise<CommandConfigVO> {
    const configs = await this.getShellToolConfigs();
    const command = configs.find((config) => config.tool === "Command");
    if (command) {
      return {
        encryptors: command.params.find((param) => param.name === "encryptor")?.options ?? [],
        implementationClasses:
          command.params.find((param) => param.name === "implementationClass")?.options ?? [],
      };
    }
    return this.request<CommandConfigVO>("GET", "/api/config/command/configs");
  }

  async getShellToolConfigs(): Promise<ToolConfigDescriptor[]> {
    try {
      return await this.request<ToolConfigDescriptor[]>("GET", "/api/config/shelltool/configs");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return [];
      throw err;
    }
  }

  getObfuscationOptions(): Promise<ObfuscationOption[]> {
    return this.request<ObfuscationOption[]>("GET", "/api/config/obfuscation/options");
  }

  async getProbeResponseServers(): Promise<string[]> {
    try {
      return await this.request<string[]>("GET", "/api/config/probe/response/servers");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return [];
      throw err;
    }
  }

  getVersion(): Promise<VersionInfo> {
    return this.request<VersionInfo>("GET", "/api/version");
  }

  async getPlugins(): Promise<PluginDescriptor[]> {
    try {
      return await this.request<PluginDescriptor[]>("GET", "/api/plugins");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return [];
      throw err;
    }
  }

  // ---------- generation ----------

  async generateMemShell(req: MemShellGenerateRequest): Promise<MemShellGenerateResponse> {
    const apiVersion = await this.getGenerationApiVersion();
    try {
      return await this.request<MemShellGenerateResponse>("POST", "/api/memshell/generate", {
        json: apiVersion === "v2" ? toLegacyMemShellRequest(req) : req,
      });
    } catch (err) {
      if (apiVersion === "v3" && err instanceof ApiError && /Unsupported packer:/.test(err.message)) {
        throw new ApiError(
          `${err.message}. On v3, packer groups are only categories; choose a leaf from 'memparty config packers' (e.g. DefaultBase64, not Base64).`,
          err.status,
          err.url,
        );
      }
      throw err;
    }
  }

  private getGenerationApiVersion(): Promise<"v2" | "v3"> {
    this.generationApiVersion ??= this.getVersion()
      .then((version) => (Number(version.currentVersion.split(".")[0]) >= 3 ? "v3" : "v2"))
      .catch(() => "v3" as const);
    return this.generationApiVersion;
  }

  generateProbe(req: ProbeShellGenerateRequest): Promise<ProbeShellGenerateResponse> {
    return this.request<ProbeShellGenerateResponse>("POST", "/api/probe/generate", {
      json: req,
    });
  }

  /** Parse a fully-qualified class name from a base64-encoded .class file. */
  parseClassName(classBase64: string): Promise<string> {
    return this.request<string>("POST", "/api/className", {
      text: classBase64,
      raw: true,
    });
  }

  decodeBytecode(classBase64: string): Promise<BytecodeResult> {
    return this.request<BytecodeResult>("POST", "/api/bytecode/decode", {
      text: classBase64,
    });
  }

  transformBytecode(req: BytecodeTransformRequest): Promise<BytecodeTransformResponse> {
    return this.request<BytecodeTransformResponse>("POST", "/api/bytecode/transform", {
      json: req,
    });
  }

  // ---------- transport ----------

  private async request<T>(
    method: string,
    path: string,
    opts: { json?: unknown; text?: string; raw?: boolean } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {};
    let body: string | undefined;

    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.text !== undefined) {
      headers["Content-Type"] = "text/plain";
      body = opts.text;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new ApiError(`Request timed out after ${this.timeoutMs}ms`, 0, url);
      }
      throw new ApiError(
        `Failed to reach ${url}: ${(err as Error).message}`,
        0,
        url,
      );
    } finally {
      clearTimeout(timer);
    }

    const rawText = await response.text();

    if (!response.ok) {
      let message = rawText || response.statusText;
      try {
        const parsed = JSON.parse(rawText) as ApiErrorResponse;
        if (parsed?.error) message = parsed.error;
      } catch {
        // body was not JSON — keep raw text
      }
      throw new ApiError(message, response.status, url);
    }

    if (opts.raw) {
      return rawText as unknown as T;
    }
    if (rawText === "") {
      return undefined as unknown as T;
    }
    return JSON.parse(rawText) as T;
  }
}

function toLegacyMemShellRequest(req: MemShellGenerateRequest): MemShellGenerateRequest {
  const { pass, key, paramName, template, ...common } = req.shellToolConfig;
  const { obfuscation: _obfuscation, obfuscationScope: _obfuscationScope, ...shellConfig } =
    req.shellConfig;
  return {
    ...req,
    shellConfig: {
      ...shellConfig,
      probe: shellConfig.probe ? true : undefined,
    },
    shellToolConfig: {
      ...common,
      godzillaPass: req.shellConfig.shellTool.startsWith("Godzilla") ? pass : undefined,
      godzillaKey: key,
      commandParamName: paramName,
      commandTemplate: template,
      behinderPass: req.shellConfig.shellTool === "Behinder" ? pass : undefined,
      antSwordPass: req.shellConfig.shellTool === "AntSword" ? pass : undefined,
    },
  };
}
