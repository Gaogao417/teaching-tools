/** Metric geometry and immutable catalog compatibility; no canonical writes/API calls. */
import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import * as catalogs from '../GoldenWorkspaceCatalog';
import { workspaceCatalogPin } from '../../tutorSession/WorkspacePresentationCatalogV5';
import { TutorTaskBindingResolver, type TutorTaskBinding } from '../TutorTaskBindingResolver';
import { importReviewCandidate } from '../../planBuild/c1/ImportReviewCandidate';
import { importApprovedPlanV5 } from '../../planBuild/v5/ImportApprovedPlanV5';
import { TutorSessionOrchestratorV7 } from '../TutorSessionOrchestratorV7';
import { TutorSessionOrchestratorV6 } from '../TutorSessionOrchestratorV6';
import { TutorSessionOrchestratorV5 } from '../TutorSessionOrchestratorV5';
import { FixedResponseGateProvider } from '../../tutorNavigator/ModelGateAdjudicatorV5';
import { f6Model } from './f6Support';
import { projectHttpSnapshotV1 } from '../V7HttpSnapshotProjector';
import { applyDomainCommands } from '../../../../../shared/actionWorld';
import { PRESENTER_PROMPT_VERSION } from '../presentationGeneration/PresenterPrompts';
import type { PresenterGeneratorPort } from '../presentationGeneration/GeneratorPort';
import { db } from '../../../db/database';

const root='/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring';
const draft=importReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/c1-teach-follow-along/candidate-v13-r3')});
const approved=importApprovedPlanV5({canonicalRoot:root},'TP-SMV-009');
if(!draft.ok)throw Error(draft.errors.join(';'));if(!approved.ok)throw Error(approved.errors.join(';'));
const presenter:PresenterGeneratorPort={provider:'geometry-test',modelId:'geometry-test',pin:{provider:'geometry-test',model_id:'geometry-test',prompt_version:PRESENTER_PROMPT_VERSION,context_builder_version:'presentation-context-builder/v1',tool_catalog_version:'presentation-tool-catalog/v1'},async generatePresentationDraft(){throw Error('start/restore must not call presenter');}};
const model=f6Model(new FixedResponseGateProvider([],'geometry-pin-test'),'geometry-pin-test');
const imported=draft.imported;
const current=catalogs.buildGoldenWorkspaceCatalogV5(imported);
const legacy=catalogs.buildLegacyGoldenWorkspaceCatalogV5(imported);
const resolver=()=>new TutorTaskBindingResolver(root,()=>draft);
const asLegacy=(binding:TutorTaskBinding):TutorTaskBinding=>({...binding,golden:catalogs.buildLegacyGoldenWorkspaceCatalogV5(binding.imported)});
class HistoricalStartResolver extends TutorTaskBindingResolver {
 override resolveForStart(id:string){return asLegacy(super.resolveForStart(id));}
}
let serial=0;
const nextId=()=>`TS-992000${String(++serial).padStart(4,'0')}`;
const count=()=> (db.prepare('SELECT count(*) AS n FROM tutor_session_events').get() as {n:number}).n;
const p=Object.fromEntries(current.catalog.baseGeometry!.points.map(p=>[p.id,p]));
const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
const length=(a:string,b:string)=>distance(p[a],p[b]);
function cosine(a:string,o:string,b:string){return ((p[a].x-p[o].x)*(p[b].x-p[o].x)+(p[a].y-p[o].y)*(p[b].y-p[o].y))/(length(a,o)*length(b,o));}

describe('golden geometry is Euclidean and consistent with the approved problem',()=>{
 it('preserves AB=AC=4, BC=6, AD=DC=8/3 and BD=10/3 under one scale',()=>{
  const s=length('B','C')/6;
  expect(length('A','B')/length('B','C')).toBeCloseTo(2/3,12);
  expect(length('A','B')/s).toBeCloseTo(4,12);expect(length('A','C')/s).toBeCloseTo(4,12);
  expect(length('A','D')).toBeCloseTo(length('D','C'),12);
  expect(length('A','D')/s).toBeCloseTo(8/3,12);expect(length('B','D')/s).toBeCloseTo(10/3,12);
  expect(cosine('D','A','C')).toBeCloseTo(cosine('A','C','D'),12);
 });
 it('C/E are reflections across AD: midpoint on the crease, CE perpendicular to it, AE=AC and DE=DC',()=>{
  const mid={x:(p.C.x+p.E.x)/2,y:(p.C.y+p.E.y)/2};
  const dx=p.D.x-p.A.x,dy=p.D.y-p.A.y;
  expect((mid.x-p.A.x)*dy-(mid.y-p.A.y)*dx).toBeCloseTo(0,8);
  expect((p.E.x-p.C.x)*dx+(p.E.y-p.C.y)*dy).toBeCloseTo(0,8);
  expect(length('A','E')).toBeCloseTo(length('A','C'),10);
  expect(length('D','E')).toBeCloseTo(length('D','C'),10);
  expect(p.E.y).toBeGreaterThan(p.B.y);
  expect(length('B','E')/(length('B','C')/6)).toBeCloseTo(1,12);
 });
 it('existing RES7 committed constructions produce O on AE and BC with the approved AO/OE lengths',()=>{
  const resource=imported.plan.resources.find(r=>r.resource_id==='RES7')!;
  const commands=JSON.parse(resource.content!).constructions;
  const world=applyDomainCommands({revision:0,geometry:current.catalog.baseGeometry!},commands);
  if(!world.geometry)throw Error('RES7 lost base geometry');
  const o=world.geometry.points.find(p=>p.id==='pt-O')!;
  expect(o.y).toBeCloseTo(p.B.y,10);expect(o.x).toBeGreaterThan(p.B.x);expect(o.x).toBeLessThan(p.D.x);
  const scale=length('B','C')/6;
  expect(distance(p.A,o)/scale).toBeCloseTo(16/5,10);
  expect(distance(p.E,o)/scale).toBeCloseTo(4/5,10);
 });
 it('changes only base coordinates and content hash; no capability, authored IDs or board permissions are added',()=>{
  const {baseGeometry:oldGeometry,...oldRest}=legacy.catalog;
  const {baseGeometry:newGeometry,...newRest}=current.catalog;
  expect(newRest).toEqual(oldRest);expect(newGeometry!.segments).toEqual(oldGeometry!.segments);
  expect(newGeometry!.points.map(x=>[x.id,x.derived])).toEqual(oldGeometry!.points.map(x=>[x.id,x.derived]));
  expect(workspaceCatalogPin(current.catalog).content_hash).not.toBe(workspaceCatalogPin(legacy.catalog).content_hash);
  // Recorded from the pre-fix committed factory, including all board entries.
  expect(workspaceCatalogPin(legacy.catalog).content_hash).toBe('sha256:658ddc41d65f56d7a8a58affeb102e684956dd786e6da41f480472acf7c84cf1');
  expect(workspaceCatalogPin({...legacy.catalog,initialInteractionMode:'locked'}).content_hash).toBe('sha256:b0ab29e659f4c0559e433bebf97637c3fd8db3bc695aef1399eb10220462356d');
 });
});

describe('catalog lookup is exact and mode-preserving',()=>{
 for(const [name,golden] of [['current',current],['legacy',legacy]] as const){
  it.each(['teaching','assessment'] as const)(`${name} %s restores the complete original catalog pin`,mode=>{
   const catalog=mode==='assessment'?{...golden.catalog,initialInteractionMode:'locked' as const}:golden.catalog;
   const pin=workspaceCatalogPin(catalog);
   expect(catalogs.goldenWorkspaceCatalogForPin(imported,pin,mode).catalog).toEqual(catalog);
   expect(()=>catalogs.goldenWorkspaceCatalogForPin(imported,pin,mode==='teaching'?'assessment':'teaching')).toThrow(/catalog/);
  });
 }
 it('unknown hashes and mismatched pin metadata are rejected',()=>{
  for(const pin of [undefined,{content_hash:`sha256:${'f'.repeat(64)}`},{...workspaceCatalogPin(legacy.catalog),catalog_schema_version:99},{...workspaceCatalogPin(current.catalog),entry_count:0}])
   expect(()=>catalogs.goldenWorkspaceCatalogForPin(imported,pin,'teaching')).toThrow(/workspace_catalog_pin/);
 });
});

describe('start/restore use the same selected geometry, registry and all pins',()=>{
 it.each([['current','v7'],['legacy','v7'],['current','v9'],['legacy','v9']] as const)('Draft injected %s %s session restores without changing pins, events or rendered base',(kind,version)=>{
  const bindingResolver=kind==='legacy'?new HistoricalStartResolver(root,()=>draft):resolver();
  const session=TutorSessionOrchestratorV7.start({sessionId:nextId(),studentId:'geometry-test',taskId:'goldenMinhangFold2020',canonicalRoot:root,bindingResolver,model,...(version==='v9'?{presenter}:{})});
  const before=count(),events=structuredClone(session.events);
  const restored=TutorSessionOrchestratorV7.resume({sessionId:session.sessionId,canonicalRoot:root,bindingResolver:resolver(),model,...(version==='v9'?{presenter}:{})});
  const expected=kind==='legacy'?legacy:current;
  expect(restored.sessionCatalog).toEqual(expected.catalog);
  expect((restored.events[0].payload as any).workspace_catalog_pin).toEqual(workspaceCatalogPin(expected.catalog));
  expect(restored.events).toEqual(events);expect(count()).toBe(before);
  expect(projectHttpSnapshotV1({orchestrator:restored})).toEqual(projectHttpSnapshotV1({orchestrator:session}));
  expect(restored.assertReplayParity().equal).toBe(true);
  const selected=resolver().resolveForRestore('goldenMinhangFold2020',restored.events[0].payload);
  expect(selected.golden.catalog).toEqual(expected.catalog);
  expect(selected.registry).toEqual(resolver().v7RegistryProvider(restored.events[0].payload));
 });
 it('legacy assessment restores locked geometry and rejects a teaching-mode reinterpretation',()=>{
  const bindingResolver=new HistoricalStartResolver(root);
  const session=TutorSessionOrchestratorV7.start({sessionId:nextId(),studentId:'geometry-test',taskId:'goldenMinhangFold2020',canonicalRoot:root,bindingResolver,model,assessment:true});
  const restored=TutorSessionOrchestratorV7.resume({sessionId:session.sessionId,canonicalRoot:root,model});
  expect(restored.sessionCatalog.initialInteractionMode).toBe('locked');
  expect(restored.sessionCatalog.baseGeometry).toEqual(legacy.catalog.baseGeometry);
  const payload=restored.events[0].payload;
  expect(()=>new TutorTaskBindingResolver(root).v7RegistryProvider({...payload,session_mode:'teaching'})).toThrow(/catalog/);
 });
 it('historical v6 reader retains its legacy base rather than rebuilding the new one',()=>{
  const original=TutorTaskBindingResolver.prototype.resolveForStart;
  const spy=vi.spyOn(TutorTaskBindingResolver.prototype,'resolveForStart').mockImplementation(function(this:TutorTaskBindingResolver,id:string){return asLegacy(original.call(this,id));});
  let session:TutorSessionOrchestratorV6;
  try{session=TutorSessionOrchestratorV6.start({sessionId:nextId(),studentId:'geometry-test',taskId:'goldenMinhangFold2020',canonicalRoot:root,model});}finally{spy.mockRestore();}
  const before=count();const restored=TutorSessionOrchestratorV6.resume({sessionId:session.sessionId,canonicalRoot:root,model});
  expect((restored as any).binding.golden.catalog.baseGeometry).toEqual(legacy.catalog.baseGeometry);
  expect(count()).toBe(before);
 });
 it.each([false,true])('historical v5 reader preserves legacy geometry and assessment=%s',assessment=>{
  const spy=vi.spyOn(catalogs,'buildGoldenWorkspaceCatalogV5').mockImplementation(catalogs.buildLegacyGoldenWorkspaceCatalogV5);
  let session:TutorSessionOrchestratorV5;
  try{session=TutorSessionOrchestratorV5.start({sessionId:nextId(),studentId:'geometry-test',canonicalRoot:root,model,assessment});}finally{spy.mockRestore();}
  const before=count();const restored=TutorSessionOrchestratorV5.resume({sessionId:session.sessionId,canonicalRoot:root,model});
  expect((restored as any).golden.catalog.baseGeometry).toEqual(legacy.catalog.baseGeometry);
  expect((restored as any).golden.catalog.initialInteractionMode).toBe(assessment?'locked':'construction');
  expect(count()).toBe(before);
 });
});
