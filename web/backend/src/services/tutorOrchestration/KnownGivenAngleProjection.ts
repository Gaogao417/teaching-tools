import {visualBindingSchema} from '../../../../shared/canonical/visualSchemas';
import type {TopicGeometryTeachingMark} from '../../../../shared/topicPractice';
export type ProblemGivenAngleMark=Extract<TopicGeometryTeachingMark,{kind:'angle-equality'}>;
/** Structural copying of problem givens only; no current lease or equality closure. */
export function selectGivenAngleMarks(bindings: readonly unknown[],facts: readonly {fact_id:string;role:string;reveals_answer?:boolean}[]): ProblemGivenAngleMark[] {
 const given=new Set(facts.filter(f=>f.role==='given'&&f.reveals_answer===false).map(f=>f.fact_id));
 return bindings.flatMap(raw=>{
  const parsed=visualBindingSchema.safeParse(raw);if(!parsed.success)return [];
  const b=parsed.data;if(b.relation.type!=='angle-equality'||!b.basis_refs.length||b.basis_refs.some(ref=>!given.has(ref)))return [];
  return [{id:`given-angle:${b.binding_id}`,kind:'angle-equality' as const,source:'problem-given' as const,angles:b.relation.angles.map(a=>({vertex:a.vertex,rayPoints:[...a.ray_points] as [string,string],sector:a.sector}))}];
 });
}
export function projectGivenAngles(marks: readonly ProblemGivenAngleMark[], geometry: Record<string,unknown>): ProblemGivenAngleMark[] {
 const points=new Set((Array.isArray(geometry.points)?geometry.points as {id:string}[]:[]).map(p=>p.id));
 return marks.filter(m=>m.angles.every(a=>[a.vertex,...a.rayPoints].every(p=>points.has(p)))).map(m=>structuredClone(m));
}
