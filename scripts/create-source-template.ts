import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sourceTemplate } from "../src/lib/sources/template";

const [destination, repository] = process.argv.slice(2);
if (!destination || !repository) throw new Error("Usage: tsx scripts/create-source-template.ts <new-directory> PointCommunity/<repo>");
const files = sourceTemplate(repository);
const root = resolve(destination);
await mkdir(root);
for (const [path, content] of Object.entries(files)) {
  const target = resolve(root, path);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, content, { flag: "wx" });
}
process.stdout.write(`Created PointGuide source structure at ${root}. Add reviewed evidence and inventory entries, then run scripts/validate-source-contract.ts before admission.\n`);
