# MCP reference

Use the connected tool schemas as the source of truth. The main Skill's workflows apply to both CLI and MCP.

## Tool map

| Task | MCP tools |
|------|-----------|
| Backend discovery | `server_version`, `list_servers`, `list_config`, `list_packers`, `list_command_configs`, `list_shell_tool_configs`, `list_obfuscation_options` |
| Plugins | `list_plugins`, `list_remote_options` |
| Generation and probes | `generate_memshell`, `generate_probe` |
| Bytecode | `bytecode_decode`, `bytecode_transform`, `parse_classname` |
| Connection and operations | `connect_test`, `exec_command`, `download_file`, `upload_file` |
| Saved targets | `target_save`, `target_note`, `target_list`, `target_remove` |
| History | `log_list` |

Generation uses `server`, `shellTool`, `shellType`, and `packer`. Use `outputFile` to write a generated payload to disk. Plugin fields accept `toolOptions` values as strings or JSON objects; `toolOptionJson` is the string-encoded alternative.

`connect_test` takes the URL or saved target name plus protocol, credentials, and auth header. `exec_command` uses `command` for the CLI's `--cmd`. Transfer tools use `remotePath`, `localPath`, and optional `force`; local paths are resolved on the machine running the MCP server.

`target_save` uses `project`, `shell`, `url`, `tool`, credentials, `projectRemark`, `projectCategory`, and `shellRemark`. Other tools refer to the saved target as `name: "<project>/<shell>"`.

`log_list` supports `category`, `target`, and `limit`.

`profile`, `custom build`, and `demo` currently require the CLI; no corresponding MCP tools are registered. Follow the mimic reference and run those commands locally.
