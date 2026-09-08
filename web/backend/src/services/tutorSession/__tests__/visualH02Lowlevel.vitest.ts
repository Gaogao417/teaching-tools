import {expect,it} from 'vitest';
import {ZodError} from 'zod';
import type {VisualBinding,VisualOwner} from '../../../../../shared/canonical/visualSchemas';
import {VisualBindingCatalog,VisualBindingError} from '../VisualBindingCatalog';
import {emptyVisualState} from '../WorkspaceVisualReducer';
import {VisualIntentCompiler} from '../../tutorOrchestration/presentationGeneration/VisualIntentCompiler';
const owner:VisualOwner={scope:{kind:'approved',protocol_id:'PR-SMV-001',beat_id:'BT-02'},scope_epoch:1,part_ref:'Q1'};
const angle:VisualBinding={binding_kind:'geometry_visual',binding_id:'VB-301',purpose:'equal angles',basis_refs:['FN-01'],allowed_scopes:[owner.scope],reveal_scope:'intermediate_result',required_constructions:[],max_lifetime:'problem-part',relation:{type:'angle-equality',angles:[{vertex:'A',ray_points:['B','C'],sector:'minor'},{vertex:'D',ray_points:['E','F'],sector:'minor'}]},allowed_forms:['angle-arcs']};
const points=new Map(Object.entries({A:{x:0,y:0},B:{x:2,y:0},C:{x:0,y:2},D:{x:4,y:0},E:{x:5,y:0},F:{x:4,y:1}}));
function source(binding:VisualBinding){return {planHash:`sha256:${'a'.repeat(64)}`,bindings:[binding],approvedBasisRefs:new Set(['FN-01']),approvedScopes:new Set(['PR-SMV-001/BT-02']),expressions:new Map<string,string>(),pointIds:new Set(points.keys()),segments:new Map<string,readonly[string,string]>(),constructionOutputs:new Map<string,string[]>()};}
it.each(['duplicate-vertex','zero-degree','unknown-construction-output'] as const)('H02 %s fails closed before any visual command or Workspace mutation',fault=>{
 const binding=structuredClone(angle),input=source(binding),positions=structuredClone(points),state=emptyVisualState();
 if(binding.relation.type!=='angle-equality')throw Error('fixture');
 if(fault==='duplicate-vertex')binding.relation.angles[0].ray_points[0]='A';
 if(fault==='zero-degree'){
  positions.set('C',{x:4,y:0});const a=positions.get('A')!,b=positions.get('B')!,c=positions.get('C')!;
  expect((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)).toBe(0);
  expect((b.x-a.x)*(c.x-a.x)+(b.y-a.y)*(c.y-a.y)).toBeGreaterThan(0);
 }
 if(fault==='unknown-construction-output'){binding.required_constructions=['VB-construct'];input.constructionOutputs.set('VB-construct',['O']);binding.relation.angles[0].ray_points[1]='O-unknown';}
 const before=structuredClone({input,positions,state});let command:unknown;
 try{
  const catalog=new VisualBindingCatalog(input);
  command=new VisualIntentCompiler({catalog,state,owner,sessionId:'TS-99002301',sequenceId:'PS-0001',permission:{completedConstructions:new Set(['VB-construct']),existingPoints:positions,revealAuthorized:()=>true}}).compile({tool_id:'geometry.annotate',binding_ref:binding.binding_id,params:{form:'angle-arcs',lifetime:'teaching-scope'}},0,'WSA-99002301-0001');
  throw Error('invalid angle unexpectedly compiled');
 }catch(error){
  if(fault==='duplicate-vertex'){expect(error).toBeInstanceOf(ZodError);expect((error as ZodError).issues).toEqual(expect.arrayContaining([expect.objectContaining({path:['relation','angles',0],message:'angle requires three distinct points'})]));}
  else {expect(error).toBeInstanceOf(VisualBindingError);expect((error as VisualBindingError).code).toBe(fault==='zero-degree'?'VISUAL_DEGENERATE_TARGET':'INVALID_VISUAL_BINDING');if(fault==='unknown-construction-output')expect((error as Error).message).toMatch(/unknown point or missing construction dependency/);}
 }
 expect(command).toBeUndefined();expect({input,positions,state}).toEqual(before);expect(state.annotations).toHaveLength(0);expect(state.groups).toHaveLength(0);expect(positions.has('O-unknown')).toBe(false);
});
