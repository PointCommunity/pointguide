import { execFileSync } from "node:child_process";
import { validateChecksumManifest } from "../src/lib/evidence/corpus";
const root=process.env.CORPUS_ROOT; const manifest=process.env.CORPUS_MANIFEST ?? "research/midas-m32/checksums.sha256";
if(!root) throw new Error("CORPUS_ROOT is required.");
const commit=execFileSync("git",["-C",root,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
const requested=process.argv[process.argv.indexOf("--ref")+1]; if(requested && requested!=="HEAD" && requested!==commit) throw new Error("Corpus checkout does not match requested commit.");
const result=await validateChecksumManifest(root,manifest); process.stdout.write(JSON.stringify({repositoryRoot:root,commit,checked:result.checked})+"\n");
