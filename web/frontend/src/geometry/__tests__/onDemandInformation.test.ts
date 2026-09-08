import {describe,it,expect,vi} from 'vitest';
import {GeometryModel} from '../domain/model';
import {projectVisualScene} from '../react/projectVisualScene';
import {VisualEffectRegistry} from '../react/VisualEffectRegistry';
import type {VisualView} from '../../../../shared/canonical/visualSchemas';
const model=new GeometryModel({points:[{id:'A',x:90,y:40},{id:'B',x:30,y:200},{id:'C',x:250,y:200},{id:'D',x:130,y:200}],lines:[{id:'AC',kind:'segment',from:'A',to:'C'},{id:'CA',kind:'segment',from:'C',to:'A'}]});
const viewport={width:300,height:300,project:(p:{x:number;y:number})=>p};
const v=():VisualView=>({visual_revision:1,digest:'sha256:'+'a'.repeat(64),annotations:[{annotation_id:'ann',binding_ref:'VB-104',form:'paired-sides',role_key:'sides',version:1,owner_keys:['owner'],resolved_targets:{entity_ids:['C','A','D','B'],triangles:{left:['C','A','D'],right:['C','B','A']}}},{annotation_id:'length',binding_ref:'VB-105',form:'length-label',role_key:'length',version:1,owner_keys:['owner'],content:'$AC=4$',resolved_targets:{entity_ids:['AC','CA']}}],focus:null});
const execution=()=>({sessionId:'session',executionKey:'baseline',visualRevision:1,targetDigest:'digest',surfaceGeneration:1,operation:'installed' as const,abort:new AbortController().signal});
function mount(enabled=()=>true){const host=document.createElement('div');document.body.append(host);const registry=new VisualEffectRegistry(host,{surfaceGeneration:1,reducedMotion:()=>true,inspectionEnabled:enabled,measureText:()=>({x:20,y:20,width:60,height:20})});return{host,registry,dispose(){registry.dispose();host.remove();}};}
describe('on-demand information v2',()=>{
 it('quiet scene merges CA/AC and exposes only authorized length, not correspondence',()=>{
  const scene=projectVisualScene(v(),model,viewport,{onDemand:true});expect(scene.glyphs).toHaveLength(0);
  const matches=scene.inspectionTargets!.filter(t=>t.id==='segment:A|C');expect(matches).toHaveLength(1);
  expect(matches[0].descriptions).toEqual(['$AC=4$']);
  expect(matches[0].descriptions.join()).not.toContain('↔');
 });
 it('focus shows just current pair plus authorized content, not all prior pairs',()=>{
  const view=v();view.annotations.push({annotation_id:'ratio',binding_ref:'VB-104',form:'ratio-label',role_key:'ratio',content:'$CA/CB=2/3$',resolved_targets:{entity_ids:['AC']},owner_keys:['owner'],version:1});
  view.focus={group_id:'g',binding_ref:'VB-104',mode:'steady',owner_key:'owner',resolved_targets:{entity_ids:['C','A','B'],paired_sides:[{endpoints:['C','A']},{endpoints:['C','B']}]}};
  const scene=projectVisualScene(view,model,viewport,{onDemand:true});expect(scene.glyphs).toHaveLength(2);expect(scene.teachingInformation).toEqual(['对应边：CA ↔ CB','$CA/CB=2/3$']);
 });
 it('exposes explicit authorized equal angles at distinct sectors',()=>{
  const view=v();view.annotations=[{annotation_id:'angles',binding_ref:'VB-102',form:'angle-arcs',role_key:'angles',owner_keys:['owner'],version:1,resolved_targets:{entity_ids:['A','B','C','D'],angles:[{vertex:'A',ray_points:['B','C'],sector:'minor'},{vertex:'A',ray_points:['D','C'],sector:'minor'}]}}];
  expect(projectVisualScene(view,model,viewport,{onDemand:true}).inspectionTargets).toHaveLength(2);
 });
 it('focus/hover/Escape and invalidation use one card; old callback cannot reopen it',async()=>{
  const t=mount();try{await t.registry.install(projectVisualScene(v(),model,viewport,{onDemand:true}),execution());
   const hit=t.host.querySelector<SVGElement>('[data-visual-inspect-id="segment:A|C"]')!;
   hit.dispatchEvent(new FocusEvent('focus'));expect(t.host.querySelector('[role="tooltip"]')?.textContent).toContain('AC=4');
   document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));expect(t.host.querySelector('[role="tooltip"]')).toBeNull();
   hit.dispatchEvent(new MouseEvent('pointerenter'));expect(t.host.querySelector('[role="tooltip"]')).not.toBeNull();
   t.registry.suppress('*');expect(t.host.querySelector('[role="tooltip"]')).toBeNull();hit.dispatchEvent(new FocusEvent('focus'));expect(t.host.querySelector('[role="tooltip"]')).toBeNull();
  }finally{t.dispose();}
 });
 it('inspection dismissal restores current teaching and tool clicks still bubble',async()=>{
  let enabled=true;const t=mount(()=>enabled);try{const scene=projectVisualScene(v(),model,viewport,{onDemand:true});scene.teachingInformation=['当前讲解'];await t.registry.install(scene,execution());
   const hit=t.host.querySelector<SVGElement>('[data-visual-inspect-id]')!;hit.dispatchEvent(new FocusEvent('focus'));expect(t.host.querySelector('[role="tooltip"]')?.textContent).toContain('当前讲解');
   document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));expect(t.host.querySelector('[data-visual-information-card="teaching"]')?.textContent).toBe('当前讲解');
   enabled=false;const tool=vi.fn();t.host.addEventListener('pointerdown',tool);hit.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true}));hit.dispatchEvent(new MouseEvent('click',{bubbles:true}));expect(tool).toHaveBeenCalledOnce();expect(t.host.querySelector('[data-visual-information-card="inspection"]')).toBeNull();
  }finally{t.dispose();}
 });
 it('upsert remains really visible until finite completion, then quiet; retry never replays',async()=>{
  const previous=SVGElement.prototype.animate;let finish!:()=>void;const animate=vi.fn(()=>({finished:new Promise<void>(r=>finish=r),cancel:vi.fn()}));SVGElement.prototype.animate=animate as never;
  const t=mount();try{const scene=projectVisualScene(v(),model,viewport,{onDemand:true,presentationIds:['ann']});const action={...execution(),executionKey:'upsert',operation:'entrance-complete' as const,pulseIds:['ann'],presentationIds:['ann'],transientReveal:true};
   let done=false;const pending=t.registry.install(scene,action).then(()=>done=true);await Promise.resolve();expect(done).toBe(false);expect(t.host.querySelectorAll('[data-visual-id]').length).toBeGreaterThan(0);expect(t.host.querySelector('[data-visual-information-card="teaching"]')).not.toBeNull();
   finish();await pending;expect(done).toBe(true);expect(t.host.querySelectorAll('[data-visual-id]')).toHaveLength(0);expect(t.host.querySelector('[data-visual-information-card]')).toBeNull();await t.registry.install(scene,action);expect(animate).toHaveBeenCalledOnce();
  }finally{t.dispose();SVGElement.prototype.animate=previous;}
 });
});

it('only typed known length marks enter inspection, never share or correspondence ticks',()=>{
 const geometry=new GeometryModel({points:[...model.pointsList()],lines:[...model.linesList()],teachingMarks:[{id:'known',kind:'segment-label',segmentId:'AC',valueLatex:'4',labelKind:'length'},{id:'share',kind:'segment-label',segmentId:'AC',valueLatex:'99',labelKind:'share'},{id:'ticks',kind:'correspondence',segmentIds:['AC','CA'],tickCount:3}]});
 const empty={...v(),annotations:[]};const scene=projectVisualScene(empty,geometry,viewport,{onDemand:true});expect(scene.glyphs).toHaveLength(0);expect(scene.inspectionTargets).toHaveLength(1);expect(scene.inspectionTargets![0].descriptions).toEqual(['AC = 4']);expect(geometry.teachingMarksList()).toHaveLength(3);
});
it('finishing an upsert inside an active group preserves that group information',async()=>{
 const previous=SVGElement.prototype.animate;let finish!:()=>void;SVGElement.prototype.animate=(()=>({finished:new Promise<void>(r=>finish=r),cancel:vi.fn()})) as never;
 const t=mount();try{const view=v();view.focus={group_id:'g',binding_ref:'VB-104',mode:'steady',owner_key:'owner',resolved_targets:{entity_ids:['C','A','B'],paired_sides:[{endpoints:['C','A']},{endpoints:['C','B']}]}};
  const scene=projectVisualScene(view,model,viewport,{onDemand:true,presentationIds:['ann']});
  const pending=t.registry.install(scene,{...execution(),executionKey:'intro-in-group',operation:'entrance-complete',pulseIds:['ann'],presentationIds:['ann'],transientReveal:true});
  await Promise.resolve();finish();await pending;expect(t.host.querySelectorAll('[data-visual-id]')).toHaveLength(2);expect(t.host.querySelector('[data-visual-information-card="teaching"]')?.textContent).toBe('对应边：CA ↔ CB');
 }finally{t.dispose();SVGElement.prototype.animate=previous;}
});
it('three historic angle bindings do not fail a quiet restore',()=>{
 const view=v();view.annotations=Array.from({length:3},(_,i)=>({annotation_id:`angle-${i}`,binding_ref:`VB-${i+1}`,form:'angle-arcs',role_key:'angle',owner_keys:['owner'],version:1,resolved_targets:{entity_ids:['A','B','C'],angles:[{vertex:'A',ray_points:['B','C'],sector:'minor'}]}}));
 expect(projectVisualScene(view,model,viewport,{onDemand:true}).glyphs).toHaveLength(0);
 expect(()=>projectVisualScene(view,model,viewport,{onDemand:true,presentationIds:view.annotations.map(a=>a.annotation_id)})).toThrow('more than two');
});
it('suppression cannot resurrect information through old resize/reflow',async()=>{
 const t=mount();try{const scene=projectVisualScene(v(),model,viewport,{onDemand:true});scene.teachingInformation=['旧教学内容'];await t.registry.install(scene,execution());const old=t.host.querySelector('[data-visual-inspect-id]')!;
  t.registry.suppress('*');t.registry.reflow(scene);old.dispatchEvent(new FocusEvent('focus'));expect(t.host.querySelector('[data-visual-information-card]')).toBeNull();expect(t.host.querySelector('[data-visual-inspect-id]')).toBeNull();
  await t.registry.install(scene,{...execution(),executionKey:'new-valid-install'});expect(t.host.querySelector('[data-visual-inspect-id]')).not.toBeNull();
 }finally{t.dispose();}
});
it('active tool physically disables inspection hit and keyboard entry',async()=>{
 const t=mount();try{await t.registry.install(projectVisualScene(v(),model,viewport,{onDemand:true}),execution());t.registry.setInspectionEnabled(false);
  for(const hit of t.host.querySelectorAll<SVGElement>('[data-visual-inspect-id]')){expect(hit.style.pointerEvents).toBe('none');expect(hit.getAttribute('tabindex')).toBe('-1');}
 }finally{t.dispose();}
});

it('deduplicates same physical angle sector while preserving explicit alias names and equality',()=>{
 const view=v();view.annotations=[{annotation_id:'angles',binding_ref:'VB-102',form:'angle-arcs',role_key:'angles',owner_keys:['owner'],version:1,resolved_targets:{entity_ids:['C','A','D','B'],angles:[{vertex:'C',ray_points:['A','D'],sector:'minor'},{vertex:'C',ray_points:['A','B'],sector:'minor'}]}}];
 const scene=projectVisualScene(view,model,viewport,{onDemand:true});expect(scene.glyphs).toHaveLength(0);expect(scene.inspectionTargets).toHaveLength(1);expect(scene.inspectionTargets![0].label).toContain('ACD');expect(scene.inspectionTargets![0].label).toContain('ACB');expect(scene.inspectionTargets![0].descriptions).toEqual(['∠ACD = ∠ACB']);
});
it('focus alone and known side length never invent angle equality',()=>{
 const view=v();view.focus={group_id:'g',binding_ref:'VB-102',mode:'steady',owner_key:'owner',resolved_targets:{entity_ids:['A','B','C'],angles:[{vertex:'A',ray_points:['B','C'],sector:'minor'}]}};
 const scene=projectVisualScene(view,model,viewport,{onDemand:true});expect(scene.inspectionTargets!.filter(t=>t.kind==='angle')).toHaveLength(0);expect(scene.teachingInformation!.join()).not.toContain('=');
});

it('explicit problem-given angle mark enables only its given equality without closure',()=>{
 const geometry=new GeometryModel({points:[...model.pointsList()],lines:[...model.linesList()],teachingMarks:[{id:'given-VB101',kind:'angle-equality',source:'problem-given',angles:[{vertex:'A',rayPoints:['D','C'],sector:'minor'},{vertex:'C',rayPoints:['A','D'],sector:'minor'}]}]});
 const view={...v(),annotations:[]};const scene=projectVisualScene(view,geometry,viewport,{onDemand:true});expect(scene.glyphs).toHaveLength(0);expect(scene.inspectionTargets!.filter(t=>t.kind==='angle')).toHaveLength(2);expect(scene.inspectionTargets!.flatMap(t=>t.descriptions)).toEqual(['∠DAC = ∠ACD','∠DAC = ∠ACD']);expect(scene.inspectionTargets!.some(t=>t.label.includes('ABC'))).toBe(false);
 view.focus={group_id:'g',binding_ref:'VB-101',mode:'steady',owner_key:'owner',resolved_targets:{entity_ids:['A','D','C'],angles:[{vertex:'A',ray_points:['D','C'],sector:'minor'}]}};
 expect(projectVisualScene(view,geometry,viewport,{onDemand:true}).teachingInformation).toEqual(['∠DAC = ∠ACD']);
});
