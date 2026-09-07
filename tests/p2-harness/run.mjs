import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const out=mkdtempSync(resolve(tmpdir(),'p2-harness-'));
const env={...process.env,NO_COLOR:'1',TUTOR_TELEMETRY:'off'};
for(const k of ['DEEPSEEK_API_KEY','DASHSCOPE_API_KEY'])delete env[k];
const results=[];
function run(name,command,args,cwd,required=[]){
 const r=spawnSync(command,args,{cwd,env,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
 const log=(r.stdout||'')+(r.stderr||'');writeFileSync(resolve(out,name+'.log'),log);
 const missing=required.filter(x=>!log.includes(x));
 const skipped=/(?:# skipped [1-9]|# todo [1-9]|\d+ skipped|\d+ todo|^ok .*# SKIP\b|^ok .*# TODO\b)/im.test(log);
 const empty=name.includes('handshake')||name==='frontend-regression' ? !/Tests\s+\d+ passed/.test(log) : false;
 const ok=r.status===0&&!r.error&&!missing.length&&!skipped&&!empty;
 results.push({name,ok,exit:r.status,error:r.error?.message,missing,skipped,empty});
 console.log(`${ok?'PASS':'FAIL'} ${name}`);return ok;
}
const be=resolve(repo,'web/backend'),fe=resolve(repo,'web/frontend');
const build=run('backend-build','npm',['run','build'],be);
if(build){
 for(const [file,required] of [
 ['generationCoordinator',['B2 parallel drive','B2 confirmed commit rollback','B2 lost commit acknowledgement','B2 cancel during']],
 ['v9GenerationSession',['B1 online prompt','B3 resume with a changed','B4 retry_recovery after']],
 ['presentationContextBuilder',['B5 core group','B5 region fine fact','B5 resource group','B6 core inference']],
 ['presentationGenerationPipeline',['B7 dashscope with a missing','B7 dashscope with both']]]){
 run(file,process.execPath,['--test-reporter=tap',resolve(be,`dist/backend/src/services/tutorOrchestration/__tests__/${file}.test.js`)],be,required);
 }
 run('independent-context',process.execPath,[resolve(repo,'tests/p2-harness/context.cjs')],be);
}
run('frontend-typecheck','npm',['run','typecheck'],fe);
run('independent-handshake',process.execPath,[resolve(fe,'node_modules/vitest/vitest.mjs'),'run','--config',resolve(repo,'tests/p2-harness/vitest.config.mjs'),'--reporter=verbose'],fe,['control 409','control 403','pending natural-ended']);
run('frontend-regression',process.execPath,[resolve(fe,'node_modules/vitest/vitest.mjs'),'run','src/action-runtime/tutor/__tests__/useTutorLearning.bargeInRecording.test.tsx','src/action-runtime/tutor/__tests__/useTutorLearning.generation.test.tsx','--reporter=verbose'],fe,['P2-A A1','P2-A A2']);
const summary={revision:spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).stdout.trim(),results,ok:results.every(r=>r.ok),limitations:['Scripted model/HTTP/media ports; not real provider, microphone or ASR acceptance','Dynamic board execution, v7 publication and worker restart remain separate acceptance obligations']};
writeFileSync(resolve(out,'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(`Evidence: ${out}`);process.exitCode=summary.ok?0:1;
