import {visualBindingSchema} from '../../../../shared/canonical/visualSchemas';
import type {TopicGeometryTeachingMark} from '../../../../shared/topicPractice';
export type ProblemGivenAngleMark=Extract<TopicGeometryTeachingMark,{kind:'angle-equality'}>;
/** Only explicit equal-angle statements; no theorem, collinearity or equality closure. */
function explicitAngleKeys(statement:unknown):string[]|null {
 if(typeof statement!=='string')return null;
 let text=statement.trim();
 if(text.startsWith('$')&&text.endsWith('$'))text=text.slice(1,-1);
 text=text.replace(/\s/g,'');
 const terms=text.split('=');
 if(terms.length<2)return null;
 const keys:string[]=[];
 for(const term of terms){
  const match=/^(?:\\angle|∠)([A-Z])([A-Z])([A-Z])$/.exec(term);
  if(!match||new Set(match.slice(1)).size!==3)return null;
  keys.push(`${match[2]}:${[match[1],match[3]].sort().join(':')}`);
 }
 return new Set(keys).size===keys.length?keys.sort():null;
}
/** Structural copying of problem givens only; no current lease or equality closure. */
export function selectGivenAngleMarks(bindings: readonly unknown[],facts: readonly {fact_id:string;role:string;reveals_answer?:boolean;statement?:string}[]): ProblemGivenAngleMark[] {
 const given=new Map(facts.filter(f=>f.role==='given'&&f.reveals_answer===false).map(f=>[f.fact_id,explicitAngleKeys(f.statement)]));
 return bindings.flatMap(raw=>{
  const parsed=visualBindingSchema.safeParse(raw);if(!parsed.success)return [];
  const b=parsed.data;if(b.relation.type!=='angle-equality'||!b.basis_refs.length||b.basis_refs.some(ref=>!given.has(ref)))return [];
  const expected=b.relation.angles.map(a=>`${a.vertex}:${[...a.ray_points].sort().join(':')}`).sort();
  if(b.basis_refs.some(ref=>JSON.stringify(given.get(ref))!==JSON.stringify(expected)))return [];
  return [{id:`given-angle:${b.binding_id}`,kind:'angle-equality' as const,source:'problem-given' as const,angles:b.relation.angles.map(a=>({vertex:a.vertex,rayPoints:[...a.ray_points] as [string,string],sector:a.sector}))}];
 });
}
export function projectGivenAngles(marks: readonly ProblemGivenAngleMark[], geometry: Record<string,unknown>): ProblemGivenAngleMark[] {
 const points=new Set((Array.isArray(geometry.points)?geometry.points as {id:string}[]:[]).map(p=>p.id));
 return marks.filter(m=>m.angles.every(a=>[a.vertex,...a.rayPoints].every(p=>points.has(p)))).map(m=>structuredClone(m));
}
