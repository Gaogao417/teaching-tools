import type { TopicGeometryTeachingMark } from '../../../../shared/topicPractice';
export interface GivenLengthFact { readonly role: string; readonly reveals_answer?: boolean; readonly statement: string }
/** Copy explicit given literals only. This deliberately is not an algebra parser. */
export function projectKnownGivenLengths(facts: readonly GivenLengthFact[], geometry: Record<string, unknown>): TopicGeometryTeachingMark[] {
  const points = Array.isArray(geometry.points) ? geometry.points as {id:string}[] : [];
  const segments = Array.isArray(geometry.segments) ? geometry.segments as {id:string;from:string;to:string}[] : [];
  const names = new Map<string, Set<string>>();
  for (const segment of segments) {
    if (!points.some(p=>p.id===segment.from)||!points.some(p=>p.id===segment.to)||segment.from===segment.to) continue;
    for(const name of [segment.from+segment.to,segment.to+segment.from]) {
      const set=names.get(name)??new Set<string>();set.add(segment.id);names.set(name,set);
    }
  }
  const values = new Map<string,Set<string>>();
  for(const fact of facts) {
    if(fact.role!=='given'||fact.reveals_answer!==false)continue;
    // Reject unsupported/nested wrappers as a whole; never mine a valid
    // substring from an expression whose surrounding grammar is unknown.
    if(/[{}]/.test(fact.statement) || fact.statement.replaceAll('\\(', '').replaceAll('\\)', '').includes('\\')) continue;
    if(fact.statement.includes('$$') || fact.statement.includes('\\[') || fact.statement.includes('\\]')) continue;
    for(const match of fact.statement.matchAll(/\$([^$\n]+)\$|\\\(([^\n]*?)\\\)/g)) {
      const expression=(match[1]??match[2]).trim();
      const terms=expression.split('=').map(t=>t.trim());
      if(terms.length<2||!/^\d+(?:\.\d+)?$/.test(terms[terms.length-1]))continue;
      const literal=terms[terms.length-1],targets=terms.slice(0,-1).map(t=>names.get(t));
      if(targets.some(ids=>!ids||ids.size!==1))continue;
      for(const ids of targets){const id=[...ids!][0],set=values.get(id)??new Set<string>();set.add(literal);values.set(id,set);}
    }
  }
  return [...values].filter(([,values])=>values.size===1).map(([segmentId,values])=>({id:`given-length:${segmentId}`,kind:'segment-label',segmentId,valueLatex:[...values][0],labelKind:'length'}));
}
