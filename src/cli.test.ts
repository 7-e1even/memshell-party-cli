/**
 * Subprocess smoke tests: run the built dist/cli.js the way an agent or a
 * shell would, and assert on stdout / stderr / exit code. These cover the
 * commander wiring layer that unit tests cannot see (option registration,
 * help text, exitOverride, REPL, JSON error mode).
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CLI = join(__dirname, "..", "dist", "cli.js");

let storeDir: string;

beforeAll(() => {
  if (!existsSync(CLI)) {
    execFileSync("npm", ["run", "build"], { cwd: join(__dirname, ".."), stdio: "inherit" });
  }
  storeDir = mkdtempSync(join(tmpdir(), "memparty-cli-test-"));
});

afterAll(() => {
  rmSync(storeDir, { recursive: true, force: true });
});

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], input?: string): RunResult {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      MEMPARTY_TARGETS: join(storeDir, "targets.json"),
      MEMPARTY_OPLOG: join(storeDir, "operations.jsonl"),
    },
  });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

describe("cli subprocess", () => {
  it("--help shows quick-start examples and exits 0", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Quick start:");
  });

  it("every documented subcommand help has examples", () => {
    for (const cmd of ["gen", "probe", "config", "connect", "exec", "save", "log"]) {
      const r = run([cmd, "--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^Examples:$/m);
    }
  });

  it("unknown command exits 1", () => {
    expect(run(["definitely-not-a-command"]).status).toBe(1);
  });

  it("connect without URL exits 1 with a plain error", () => {
    const r = run(["connect"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no URL/);
  });

  it("with --json the same failure is a JSON document on stdout", () => {
    const r = run(["connect", "--json"]);
    expect(r.status).toBe(1);
    const doc = JSON.parse(r.stdout) as { ok: boolean; error: string };
    expect(doc.ok).toBe(false);
    expect(doc.error).toMatch(/no URL/);
  });

  it("gen --no-interactive without required flags fails as JSON with --json", () => {
    const r = run(["gen", "--no-interactive", "--json"]);
    expect(r.status).toBe(1);
    const doc = JSON.parse(r.stdout) as { ok: boolean; error: string };
    expect(doc.ok).toBe(false);
    expect(doc.error).toMatch(/Missing required option/);
  });

  it("list --json works fully offline", () => {
    const r = run(["list", "--json"]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({});
  });

  it("save accepts any registered protocol including mimic", () => {
    const r = run([
      "save",
      "lab/mimic1",
      "-u",
      "http://192.0.2.1/mimic",
      "-t",
      "mimic",
      "--profile",
      "demo",
      "--json",
    ]);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as { tool: string; profile?: string };
    expect(doc.tool).toBe("mimic");
    expect(doc.profile).toBe("demo");
  });

  it("save rejects an unknown tool", () => {
    const r = run([
      "save",
      "lab/bad",
      "-u",
      "http://192.0.2.1/bad",
      "-t",
      "not-a-protocol",
      "--json",
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not-a-protocol.*invalid|Allowed choices/);
  });
});

/** Canned generate response: an 8-byte fake class starting with CAFEBABE. */
const FAKE_CLASS = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34]);

function startGenerateMock(): Promise<Server> {
  const memShellResult = {
    shellClassName: "org.example.Shell",
    shellSize: 1234,
    shellBytesBase64Str: FAKE_CLASS.toString("base64"),
    injectorClassName: "org.example.Injector",
    injectorSize: FAKE_CLASS.length,
    injectorBytesBase64Str: FAKE_CLASS.toString("base64"),
    shellConfig: { server: "Tomcat", shellTool: "Godzilla", shellType: "Listener" },
    shellToolConfig: { godzillaPass: "pass", godzillaKey: "key" },
    injectorConfig: {},
  };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/api/memshell/generate") {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { packer: string };
        // "Base64" stands in for an aggregate packer returning several variants
        const payload =
          body.packer === "Base64"
            ? {
                memShellResult,
                allPackResults: {
                  DefaultBase64: FAKE_CLASS.toString("base64"),
                  GzipBase64: FAKE_CLASS.toString("base64"),
                },
              }
            : { memShellResult, packResult: FAKE_CLASS.toString("base64") };
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
        return;
      }
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

describe("gen -o against a mock backend", () => {
  let apiServer: Server;
  let api: string;

  // async runner: spawnSync would block the event loop and starve the in-process mock
  function runAsync(args: string[]): Promise<RunResult> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, ...args], {
        env: {
          ...process.env,
          MEMPARTY_TARGETS: join(storeDir, "targets.json"),
          MEMPARTY_OPLOG: join(storeDir, "operations.jsonl"),
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("close", (status) => resolve({ status: status ?? -1, stdout, stderr }));
    });
  }

  const GEN_ARGS = [
    "gen",
    "-s",
    "Tomcat",
    "-t",
    "Godzilla",
    "-y",
    "Listener",
    "--godzilla-pass",
    "pass",
    "--godzilla-key",
    "key",
    "--no-interactive",
  ];

  beforeAll(async () => {
    apiServer = await startGenerateMock();
    api = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => apiServer.close(resolve));
  });

  it("--json -o writes the decoded payload file and adds outputFile to the JSON", async () => {
    const out = join(storeDir, "json-mode.class");
    const r = await runAsync(["--api", api, ...GEN_ARGS, "-p", "DefaultBase64", "-o", out, "--json"]);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as {
      packResult: string;
      outputFile: { destination: string; size: number; decoded: boolean };
    };
    expect(doc.outputFile.destination).toBe(out);
    expect(doc.outputFile.decoded).toBe(true);
    expect(readFileSync(out).equals(FAKE_CLASS)).toBe(true);
  });

  it("--json without -o keeps the plain response shape (no outputFile field)", async () => {
    const r = await runAsync(["--api", api, ...GEN_ARGS, "-p", "DefaultBase64", "--json"]);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(doc.packResult).toBe(FAKE_CLASS.toString("base64"));
    expect(doc.outputFile).toBeUndefined();
  });

  it("-o with an aggregate packer fails with a leaf-packer hint", async () => {
    const r = await runAsync(["--api", api, ...GEN_ARGS, "-p", "Base64", "-o", join(storeDir, "agg.class")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/leaf packer/);
  });

  it("--json -o with an aggregate packer fails as a JSON error", async () => {
    const r = await runAsync([
      "--api",
      api,
      ...GEN_ARGS,
      "-p",
      "Base64",
      "-o",
      join(storeDir, "agg-json.class"),
      "--json",
    ]);
    expect(r.status).toBe(1);
    const doc = JSON.parse(r.stdout) as { ok: boolean; error: string };
    expect(doc.ok).toBe(false);
    expect(doc.error).toMatch(/leaf packer/);
  });
});

describe("repl", () => {
  function repl(input: string): RunResult {
    const r = spawnSync(process.execPath, [CLI], {
      input,
      encoding: "utf8",
      env: {
        ...process.env,
        MEMPARTY_REPL: "1",
        MEMPARTY_TARGETS: join(storeDir, "targets.json"),
        MEMPARTY_OPLOG: join(storeDir, "operations.jsonl"),
      },
    });
    return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
  }

  it("executes commands line by line and exits 0", () => {
    const r = repl("list --json\nbadcmd\nquit\n");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("interactive mode");
    expect(r.stdout).toContain("{}"); // list output
    expect(r.stderr + r.stdout).toMatch(/unknown command/); // badcmd reported, loop kept going
  });

  it("JSON error mode works inside the REPL", () => {
    const r = repl("connect --json\nquit\n");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"ok":false');
  });
});
