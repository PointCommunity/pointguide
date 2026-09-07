import { execFileSync } from "node:child_process"; import { readFileSync } from "node:fs";
const files=execFileSync("git",["ls-files","--cached","--others","--exclude-standard"],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,/\bsk-[A-Za-z0-9_-]{20,}\b/u,/\bgh[pousr]_[A-Za-z0-9]{30,}\b/u];
for(const file of files){ let text; try{text=readFileSync(file,"utf8");}catch{continue;} for(const pattern of patterns) if(pattern.test(text)) throw new Error(`Secret-shaped value found in ${file}`); }
process.stdout.write(`security scan passed (${files.length} tracked files)\n`);
