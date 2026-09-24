import { execFileSync } from "node:child_process";
import { loadCorpusChunks } from "../src/lib/evidence/runtime-corpus";
const root=process.env.CORPUS_ROOT;
if(!root) throw new Error("CORPUS_ROOT is required.");
const commit=execFileSync("git",["-C",root,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
const requested=process.argv[process.argv.indexOf("--ref")+1]; if(requested && requested!=="HEAD" && requested!==commit) throw new Error("Corpus checkout does not match requested commit.");
const chunks=await loadCorpusChunks(root,commit); process.stdout.write(JSON.stringify({repositoryRoot:root,commit,chunks:chunks.length,contract:"version 2 validated"})+"\n");
