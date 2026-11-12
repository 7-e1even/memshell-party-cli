import type {
  RemoteSelectUiHint,
  ShellToolConfigObject,
  ShellToolConfigValue,
  ToolConfigDescriptor,
  ToolConfigParam,
} from "../api/types.js";

export function toolConfigForTool(
  configs: ToolConfigDescriptor[],
  tool: string,
): ToolConfigDescriptor | undefined {
  return configs.find((config) => config.tool === tool);
}

export function parseShellToolConfig(
  assignments: string[] | undefined,
  params: ToolConfigParam[] | undefined,
): Record<string, ShellToolConfigValue> {
  const result: Record<string, ShellToolConfigValue> = {};
  for (const assignment of assignments ?? []) {
    const separator = assignment.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Invalid --tool-option "${assignment}". Expected name=value.`);
    }
    const name = assignment.slice(0, separator).trim();
    const rawValue = assignment.slice(separator + 1);
    if (!name) throw new Error(`Invalid --tool-option "${assignment}". Expected name=value.`);
    const param = params?.find((candidate) => candidate.name === name);
    if (params !== undefined && param === undefined) {
      throw new Error(
        `Unknown shell tool option "${name}". Available options: ${params.map((item) => item.name).join(", ") || "(none)"}.`,
      );
    }
    if (param?.type === "object") {
      result[name] = parseJsonObject(rawValue, `--tool-option ${name}`);
    } else if (rawValue.startsWith("{")) {
      result[name] = parseJsonObject(rawValue, `--tool-option ${name}`);
    } else {
      result[name] = rawValue;
    }
  }
  return result;
}

export function parseToolConfigFile(
  source: string,
  params: ToolConfigParam[] | undefined,
): Record<string, ShellToolConfigValue> {
  const parsed = parseJsonObject(source, "--tool-config");
  const assignments = Object.entries(parsed).map(([name, value]) => {
    if (typeof value === "string") return `${name}=${value}`;
    return `${name}=${JSON.stringify(value)}`;
  });
  return parseShellToolConfig(assignments, params);
}

export function validateRequiredRemoteOptions(
  config: Record<string, ShellToolConfigValue>,
  params: ToolConfigParam[] | undefined,
): void {
  const missing = (params ?? [])
    .filter((param) => param.ui?.kind === "remote-select" && param.ui.required)
    .filter((param) => {
      const value = config[param.name];
      return value === undefined || (typeof value === "string" && value.trim() === "");
    })
    .map((param) => param.name);
  if (missing.length > 0) {
    throw new Error(
      `Missing required remote shell tool option(s): ${missing.join(", ")}. ` +
        "Provide them with --tool-option or --tool-config.",
    );
  }
}

function parseJsonObject(source: string, label: string): ShellToolConfigObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    throw new Error(`${label} must be valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as ShellToolConfigObject;
}

export interface RemoteOption {
  label: string;
  value: ShellToolConfigValue;
}

export function readRemotePath(value: unknown, path: string): unknown {
  if (!path) return value;
  let current = value;
  for (const segment of path.split(".")) {
    if (
      !segment ||
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !(segment in current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function normalizeRemoteOptions(
  payload: unknown,
  hint: RemoteSelectUiHint,
  objectMode: boolean,
): RemoteOption[] {
  const items = readRemotePath(payload, hint.itemsPath);
  if (!Array.isArray(items)) {
    throw new Error("Remote options response does not contain an array at itemsPath.");
  }
  return items.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("Remote option items must be objects.");
    }
    const rawLabel = readRemotePath(item, hint.labelPath);
    if (typeof rawLabel !== "string" && typeof rawLabel !== "number") {
      throw new Error("Remote option labels must be strings or numbers.");
    }
    if (objectMode) return { label: String(rawLabel), value: item as ShellToolConfigObject };
    if (!hint.valuePath) throw new Error("String remote options require valuePath.");
    const rawValue = readRemotePath(item, hint.valuePath);
    if (typeof rawValue !== "string" && typeof rawValue !== "number") {
      throw new Error("Remote option values must be strings or numbers.");
    }
    return { label: String(rawLabel), value: String(rawValue) };
  });
}

export function validateRemoteOptionsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Remote options URL must use HTTP or HTTPS.");
  }
  return url.toString();
}

export async function fetchRemoteOptions(
  sourceUrl: string,
  hint: RemoteSelectUiHint,
  objectMode: boolean,
  fetchImpl: typeof fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<RemoteOption[]> {
  const url = validateRemoteOptionsUrl(sourceUrl);
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "follow",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Remote options request failed (${response.status} ${response.statusText}).`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Remote options response must be valid JSON.");
  }
  return normalizeRemoteOptions(payload, hint, objectMode);
}
