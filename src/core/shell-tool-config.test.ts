import { describe, expect, it, vi } from "vitest";

import type { RemoteSelectUiHint, ToolConfigParam } from "../api/types.js";
import {
  fetchRemoteOptions,
  normalizeRemoteOptions,
  parseShellToolConfig,
  parseToolConfigFile,
  readRemotePath,
  validateRemoteOptionsUrl,
  validateRequiredRemoteOptions,
} from "./shell-tool-config.js";

const REMOTE_HINT: RemoteSelectUiHint = {
  kind: "remote-select",
  urlQueryParam: "targetsUrl",
  itemsPath: "data.items",
  labelPath: "meta.name",
  valuePath: "id",
  required: true,
};

const PARAMS: ToolConfigParam[] = [
  { name: "profile", type: "object", options: [], ui: REMOTE_HINT },
  { name: "target", type: "string", options: [], ui: REMOTE_HINT },
  { name: "mode", type: "enum", options: ["fast", "safe"] },
];

describe("shell tool config", () => {
  it("accepts string, enum and object values", () => {
    expect(parseShellToolConfig([
      "mode=fast",
      'profile={"id":7,"enabled":true,"labels":["web"]}',
    ], PARAMS)).toEqual({
      mode: "fast",
      profile: { id: 7, enabled: true, labels: ["web"] },
    });
  });

  it("accepts a JSON object from inline content or a file", () => {
    expect(parseToolConfigFile('{"mode":"safe","profile":{"id":"web-1"}}', PARAMS)).toEqual({
      mode: "safe",
      profile: { id: "web-1" },
    });
  });

  it("rejects arrays and scalar object parameters", () => {
    expect(() => parseShellToolConfig(["profile=[]"], PARAMS)).toThrow(/JSON object/);
    expect(() => parseToolConfigFile("[]", PARAMS)).toThrow(/JSON object/);
  });

  it("validates known names and required remote fields", () => {
    expect(() => parseShellToolConfig(["unknown=value"], PARAMS)).toThrow(/Unknown shell tool option/);
    expect(() => validateRequiredRemoteOptions({}, PARAMS)).toThrow(/profile, target/);
    expect(() => validateRequiredRemoteOptions({ profile: { id: 1 }, target: "web-1" }, PARAMS))
      .not.toThrow();
  });

  it("allows an object without discovered metadata for programmatic callers", () => {
    expect(parseShellToolConfig(['pluginField={"nested":{"id":1}}'], undefined)).toEqual({
      pluginField: { nested: { id: 1 } },
    });
  });
});

describe("remote options", () => {
  it("reads only dot-separated object paths", () => {
    const data = { data: { items: [{ name: "Web" }] } };
    expect(readRemotePath(data, "data.items.0.name")).toBeUndefined();
    expect(readRemotePath(data, "data.items")).toHaveLength(1);
    expect(readRemotePath(data, "")).toBe(data);
  });

  it("normalizes string IDs and complete objects", () => {
    const payload = { data: { items: [{ id: 7, meta: { name: "Web" }, role: "target" }] } };
    expect(normalizeRemoteOptions(payload, REMOTE_HINT, false)).toEqual([
      { label: "Web", value: "7" },
    ]);
    expect(normalizeRemoteOptions(payload, REMOTE_HINT, true)).toEqual([
      { label: "Web", value: { id: 7, meta: { name: "Web" }, role: "target" } },
    ]);
  });

  it("fetches JSON without credentials and normalizes the selected values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { items: [{ id: "web-1", meta: { name: "Web 1" } }] },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(fetchRemoteOptions("https://example.com/options", REMOTE_HINT, false, fetchMock))
      .resolves.toEqual([{ label: "Web 1", value: "web-1" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/options",
      expect.objectContaining({ method: "GET", headers: { Accept: "application/json" } }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("credentials");
  });

  it("rejects non-HTTP endpoints and malformed remote data", async () => {
    expect(() => validateRemoteOptionsUrl("file:///tmp/options.json")).toThrow(/HTTP or HTTPS/);
    expect(() => normalizeRemoteOptions({ data: {} }, REMOTE_HINT, false)).toThrow(/array/);
    expect(() => normalizeRemoteOptions({ data: { items: [{ id: "x" }] } }, REMOTE_HINT, false))
      .toThrow(/labels/);
    const fetchMock = vi.fn().mockResolvedValue(new Response("no", { status: 502, statusText: "Bad Gateway" }));
    await expect(fetchRemoteOptions("https://example.com/options", REMOTE_HINT, false, fetchMock))
      .rejects.toThrow(/502/);
  });
});
