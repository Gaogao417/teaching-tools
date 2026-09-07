const assert=require('node:assert/strict');
const {buildPresentationContext,DEFAULT_CONTEXT_POLICY}=require('../../web/backend/dist/backend/src/services/tutorOrchestration/presentationGeneration/ContextBuilder.js');
const f=(id,text,hidden=false)=>({fact_id:id,role:'derived',statement:text,reveals_answer:hidden});
const facts=new Map([['FN-01',f('FN-01','前提')],['FN-02',f('FN-02','长'.repeat(5000))],['FN-03',f('FN-03','最终答案是42',true)]]);
const base={planRef:{artifact_id:'TP-SMV-009',version:'v11',content_hash:'sha256:'+'a'.repeat(64)},graphRef:{artifact_id:'RG-SMV-001',version:'v8',content_hash:'sha256:'+'b'.repeat(64)},graph:{facts,inferences:new Map([['IF-01',{inference_id:'IF-01',premises:['FN-01'],conclusion:'FN-03',derivation:'因此最终答案是42'}]])},beat:{protocol_id:'PR-SMV-001',beat_id:'BT-01',graph_fact_refs:['FN-01'],inference_refs:[],resource_ids:[]},recentInputs:[],eventCutoff:1,workspaceRevision:0,currentRevision:1,policy:{...DEFAULT_CONTEXT_POLICY,max_total_chars:100},sessionMode:'teaching'};

let failed=0;
function check(name,fn){try{fn();console.log('PASS '+name)}catch(e){failed++;console.error('FAIL '+name+' '+e.message)}}
check('B5 mandatory core character budget',()=>assert.throws(()=>buildPresentationContext({...base,beat:{...base.beat,graph_fact_refs:['FN-02']}}),e=>e.kind==='CONTEXT_BUDGET_EXCEEDED'));
check('B5 optional fact budget',()=>{const r=buildPresentationContext({...base,regionFineRefs:{fact_ids:['FN-02'],inference_ids:[]}});assert.ok(r.budget.approx_chars<=100);assert.ok(!r.context.selected_fact_ids.includes('FN-02'));assert.equal(r.context_truncated,true)});
check('B5 resource budget',()=>{const r=buildPresentationContext({...base,beat:{...base.beat,resource_ids:['RES1']},resourceContent:()=> '资'.repeat(5000)});assert.ok(r.budget.approx_chars<=100);assert.ok(!r.context.resource_ids.includes('RES1'));assert.equal(r.context_truncated,true)});
check('B6 private inference conclusion',()=>assert.throws(()=>buildPresentationContext({...base,beat:{...base.beat,inference_refs:['IF-01']}}),e=>e.kind==='CONTEXT_FORBIDDEN'));
check('authorized conclusion positive control',()=>{const r=buildPresentationContext({...base,beat:{...base.beat,graph_fact_refs:['FN-01','FN-03'],inference_refs:['IF-01']}});assert.ok(r.context.selected_fact_ids.includes('FN-03'))});
process.exitCode=failed?1:0;
