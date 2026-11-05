export function parseObfuscationOptions(input?: string): Record<string, unknown> | undefined {
  if (input === undefined || input.trim() === "") return undefined;
  const options: Record<string, unknown> = {};
  for (const entry of input.split(/[,\n]/)) {
    const separator = entry.indexOf("=");
    const key = entry.slice(0, separator < 0 ? undefined : separator).trim();
    if (separator < 0 || key === "") {
      throw new Error(`Invalid obfuscation option "${entry.trim()}": expected key=value.`);
    }
    if (Object.hasOwn(options, key)) {
      throw new Error(`Duplicate obfuscation option "${key}".`);
    }
    const value = entry.slice(separator + 1).trim();
    if (value === "true" || value === "false") {
      options[key] = value === "true";
    } else if (/^-?(?:\d+|\d*\.\d+)$/.test(value)) {
      options[key] = Number(value);
    } else {
      options[key] = value;
    }
  }
  return options;
}
