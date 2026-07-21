# memshell-party-cli

English | [中文](README.md)

AI-facing client for [MemShellParty](https://party.mem.mk): let an AI generate Java memshells, connect, run commands, and transfer files.

> ⚠️ Authorized testing and research only. You are responsible for use.

---

## Step 1: Install this tool

1. Install [Node.js](https://nodejs.org/) (LTS, 18+)
2. Open a terminal and paste:

```bash
npm install -g memshell-party-cli
```

3. Check it works:

```bash
memparty version
```

If you see a version number, you're good.

---

## Step 2: Teach the AI the manual (Skill)

A skill is the full how-to guide for the AI. After install, the AI follows the guide step by step — you don't need to know the details.

**Claude Code:**

```bash
memparty skill install --claude
```

**Other agents:**

```bash
memparty skill install
```

**Both:**

```bash
memparty skill install --user --claude
```

Then **restart your AI tool** so it reloads skills.

After upgrading this CLI, run the same install command again to refresh the skill.

---

## Step 3: Connect MCP (optional, recommended)

So the AI can call the tool directly. Add this to your AI's MCP config:

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

Save and restart the AI.

---

## Step 4: Talk to the AI

**Always start a new chat with this (so it uses the skill):**

```text
Please read the memshell-party skill first, then follow its steps strictly. Do not invent parameters.
```

**Generate a shell:**

```text
Follow the memshell-party skill. Generate a common Tomcat Godzilla memshell.
Give me the file, password, and key, and explain the next step in simple words.
```

**Connect and run a command:**

```text
Follow the memshell-party skill.
URL: 【http://replace-with-yours】
Type: Godzilla. Password: 【pass】. Key: 【key】.
First check it is alive, then run whoami. Explain the result simply.
```

**Transfer files:**

```text
Follow the memshell-party skill.
On the shell we already connected:
download 【/etc/passwd】 to my computer;
upload local 【tool.exe】 to 【/tmp/tool.exe】 on the server.
```

**I'm a beginner — walk me through it:**

```text
I am not technical. Please read the memshell-party skill first, then guide me step by step:
1. Generate a common Tomcat Godzilla memshell
2. Tell me in plain language what I must save
3. After I deploy it, I will send the URL; you connect and run commands
Explain each step before doing it, and wait for my OK. Only on systems I am authorized to test.
```

---

## License

MIT
