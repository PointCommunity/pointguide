import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface ChecksumValidationResult {
  checked: number;
  files: string[];
}

interface ManifestEntry {
  digest: string;
  path: string;
}

function parseManifest(contents: string): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  const paths = new Set<string>();
  for (const [index, rawLine] of contents.split(/\r?\n/u).entries()) {
    if (!rawLine.trim()) continue;
    const match = /^([a-fA-F0-9]{64})  ([^\0]+)$/u.exec(rawLine);
    if (!match) throw new Error(`invalid checksum manifest line ${index + 1}`);
    const [, digest, path] = match;
    if (paths.has(path)) throw new Error(`duplicate path in checksum manifest: ${path}`);
    paths.add(path);
    entries.push({ digest: digest.toLowerCase(), path });
  }
  if (entries.length === 0) throw new Error("checksum manifest is empty");
  return entries;
}

function assertRepositoryPath(repositoryRoot: string, path: string): string {
  if (isAbsolute(path) || path.includes("\\")) throw new Error(`path escapes repository root: ${path}`);
  const absolute = resolve(repositoryRoot, path);
  const fromRoot = relative(repositoryRoot, absolute);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`path escapes repository root: ${path}`);
  }
  return absolute;
}

export async function validateChecksumManifest(
  repositoryRoot: string,
  manifestPath: string,
): Promise<ChecksumValidationResult> {
  const canonicalRoot = await realpath(repositoryRoot);
  const manifest = assertRepositoryPath(canonicalRoot, manifestPath);
  const entries = parseManifest(await readFile(manifest, "utf8"));

  for (const entry of entries) {
    const target = assertRepositoryPath(canonicalRoot, entry.path);
    const canonicalTarget = await realpath(target);
    assertRepositoryPath(canonicalRoot, relative(canonicalRoot, canonicalTarget));
    const digest = createHash("sha256").update(await readFile(canonicalTarget)).digest("hex");
    if (digest !== entry.digest) throw new Error(`checksum mismatch: ${entry.path}`);
  }

  return { checked: entries.length, files: entries.map((entry) => entry.path) };
}
