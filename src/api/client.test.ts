import { describe, expect, it, vi } from "vitest";

import { ApiError, MemPartyClient } from "./client.js";

function jsonResponse(body: unknown, init: Partial<{ status: number; ok: boolean }> = {}): Response {
  const status = init.status ?? 200;
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("MemPartyClient", () => {
  it("strips trailing slashes from the base URL and builds GET requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ Tomcat: { Godzilla: ["Listener", "Filter"], Command: ["Filter"] } }),
    );
    const client = new MemPartyClient({ baseUrl: "http://host:8080/", fetch: fetchMock });

    const servers = await client.getServers();

    expect(servers).toEqual({ Tomcat: ["Listener", "Filter"] });
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("http://host:8080/api/config");
    expect(init.method).toBe("GET");
  });

  it("POSTs JSON bodies with the right content type", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({ memShellResult: {}, packResult: "abc" })));
    const client = new MemPartyClient({ baseUrl: "http://host", fetch: fetchMock });

    await client.generateMemShell({
      shellConfig: { server: "Tomcat", shellTool: "Godzilla", shellType: "Listener" },
      shellToolConfig: {},
      injectorConfig: {},
      packer: "Base64",
    });

    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("http://host/api/memshell/generate");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body).packer).toBe("Base64");
  });

  it("uses v3 fields without translating or retrying validation failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ currentVersion: "3.0.0", latestVersion: "3.0.0" }))
      .mockResolvedValueOnce(
        jsonResponse({ error: "Unsupported param for tool Godzilla: pass" }, { status: 400 }),
      );
    const client = new MemPartyClient({ baseUrl: "http://host", fetch: fetchMock });

    await expect(
      client.generateMemShell({
        shellConfig: { server: "Tomcat", shellTool: "Godzilla", shellType: "Listener" },
        shellToolConfig: { pass: "wrong-field" },
        injectorConfig: {},
        packer: "DefaultBase64",
      }),
    ).rejects.toThrow("Unsupported param");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body).shellToolConfig.pass).toBe("wrong-field");
  });

  it("sends parseClassName as a raw text body and returns raw text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("com.example.Foo", { status: 200 }));
    const client = new MemPartyClient({ baseUrl: "http://host", fetch: fetchMock });

    const name = await client.parseClassName("QkFTRTY0");

    expect(name).toBe("com.example.Foo");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://host/api/className");
    expect(init.headers["Content-Type"]).toBe("text/plain");
    expect(init.body).toBe("QkFTRTY0");
  });

  it("throws ApiError with the server-provided error message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "bad server" }, { status: 400 }));
    const client = new MemPartyClient({ baseUrl: "http://host", fetch: fetchMock });

    await expect(client.getConfig()).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "bad server",
    });
  });

  it("decodes and transforms bytecode using the v3 endpoints", async () => {
    const result = { className: "com.example.Foo", size: 8, classBytesBase64Str: "yv66vg==" };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(result)));
    const client = new MemPartyClient({ baseUrl: "http://host", fetch: fetchMock });

    await expect(client.decodeBytecode("e30=")).resolves.toEqual(result);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://host/api/bytecode/decode");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: "e30=",
      headers: { "Content-Type": "text/plain" },
    });

    await expect(client.transformBytecode({ classBytesBase64: "e30=", shrink: true })).resolves.toEqual(result);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://host/api/bytecode/transform");
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toEqual({
      classBytesBase64: "e30=",
      shrink: true,
    });
  });

  it("wraps network failures in ApiError with status 0", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new MemPartyClient({ baseUrl: "http://host", fetch: fetchMock });

    const err = await client.getServers().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/ECONNREFUSED/);
  });

  it("uses the v3 Command config instead of the removed command endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          tool: "Command",
          params: [
            { name: "encryptor", type: "enum", options: ["RAW", "BASE64"] },
            { name: "implementationClass", type: "enum", options: ["RuntimeExec"] },
          ],
        },
      ]),
    );
    const client = new MemPartyClient({ baseUrl: "http://host", fetch: fetchMock });

    await expect(client.getCommandConfigs()).resolves.toEqual({
      encryptors: ["RAW", "BASE64"],
      implementationClasses: ["RuntimeExec"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://host/api/config/shelltool/configs",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("falls back to the v2 Command config endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({ encryptors: ["RAW"], implementationClasses: ["RuntimeExec"] }),
      );
    const client = new MemPartyClient({ baseUrl: "http://host", fetch: fetchMock });

    await expect(client.getCommandConfigs()).resolves.toEqual({
      encryptors: ["RAW"],
      implementationClasses: ["RuntimeExec"],
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://host/api/config/command/configs");
  });

  it("translates requests for a legacy backend before generating", async () => {
    const response = { memShellResult: {}, packResult: "abc" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ currentVersion: "2.10.0", latestVersion: "3.0.0" }))
      .mockResolvedValueOnce(jsonResponse(response));
    const client = new MemPartyClient({ baseUrl: "http://host", fetch: fetchMock });

    await expect(
      client.generateMemShell({
        shellConfig: {
          server: "Tomcat",
          shellTool: "Godzilla",
          shellType: "Listener",
          probe: { probeMethod: "ResponseBody", probeContent: "Bytecode" },
          obfuscation: { enabled: true },
        },
        shellToolConfig: { pass: "pass", key: "key", headerName: "User-Agent" },
        injectorConfig: {},
        packer: "DefaultBase64",
      }),
    ).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toMatchObject({
      shellConfig: { probe: true },
      shellToolConfig: {
        godzillaPass: "pass",
        godzillaKey: "key",
        headerName: "User-Agent",
      },
    });
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body).shellConfig.obfuscation).toBeUndefined();
  });

  it("does not change generation fields when backend version discovery is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(jsonResponse({ memShellResult: {}, packResult: "abc" }));
    const client = new MemPartyClient({ baseUrl: "http://host", fetch: fetchMock });

    await expect(
      client.generateMemShell({
        shellConfig: { server: "Tomcat", shellTool: "Godzilla", shellType: "Listener" },
        shellToolConfig: { pass: "pass" },
        injectorConfig: {},
        packer: "DefaultBase64",
      }),
    ).resolves.toMatchObject({ packResult: "abc" });
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body).shellToolConfig.pass).toBe("pass");
  });
});
