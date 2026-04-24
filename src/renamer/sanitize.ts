export function sanitizeAppName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "app";
}

export function sanitizeVersion(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "") || "0.0.0";
}

export function sanitizeGeneric(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
