import {it,expect} from 'vitest';
import {projectKnownGivenLengths} from '../KnownGivenLengthProjection';
const geometry={points:['A','B','C','E'].map(id=>({id})),segments:[{id:'ab',from:'A',to:'B'},{id:'ac',from:'A',to:'C'},{id:'bc',from:'B',to:'C'},{id:'be',from:'B',to:'E'}]};
const fact=(statement:string,role='given',reveals_answer=false)=>({statement,role,reveals_answer});
it('copies literal givens to exact segments and never invents BE',()=>{expect(projectKnownGivenLengths([fact('$AB=AC=4$'),fact('$BC=6$，且 $D$ 在线段 $BC$ 上')],geometry).map(m=>[m.kind==='segment-label'&&m.segmentId,m.kind==='segment-label'&&m.valueLatex])).toEqual([['ab','4'],['ac','4'],['bc','6']]);});
it.each(['derived','goal','inference'])('never reads %s proofs or answers',role=>{expect(projectKnownGivenLengths([fact('$BE=3$',role)],geometry)).toEqual([]);});
it('refuses even given marked answer',()=>{expect(projectKnownGivenLengths([fact('$BE=3$','given',true)],geometry)).toEqual([]);});
it.each(['AB=4','$AB>4$','$AB=AC$','$AB=x$','$AB=2+2$','$AB=ZZ=4$','$ZZ=4$','$AB=\\frac{4}{1}$','$AB=4=5$'])('rejects unsupported statement %s',text=>{expect(projectKnownGivenLengths([fact(text)],geometry)).toEqual([]);});
it('conflicting explicit values remove the ambiguous segment',()=>{expect(projectKnownGivenLengths([fact('$AB=4$'),fact('$BA=5$')],geometry)).toEqual([]);});
it('ambiguous concatenated endpoint names are not guessed',()=>{const g={points:[{id:'A'},{id:'BC'},{id:'AB'},{id:'C'}],segments:[{id:'x',from:'A',to:'BC'},{id:'y',from:'AB',to:'C'}]};expect(projectKnownGivenLengths([fact('$ABC=4$')],g)).toEqual([]);});
it('preserves decimal source literal without arithmetic or input mutation',()=>{const g=JSON.stringify(geometry);expect(projectKnownGivenLengths([fact('\\(AB=4.00\\)')],geometry)[0]).toMatchObject({valueLatex:'4.00'});expect(JSON.stringify(geometry)).toBe(g);});

it.each(['$$AB=4$$',String.raw`\[$AB=4$\]`,String.raw`\($AB=4$\)`])('rejects unsupported nested delimiters %s',text=>{expect(projectKnownGivenLengths([fact(text)],geometry)).toEqual([]);});

it.each([String.raw`\text{$AB=4$}`,String.raw`\boxed{$AB=4$}`,String.raw`\unknown $AB=4$`])('rejects unknown TeX wrapper %s',text=>{expect(projectKnownGivenLengths([fact(text)],geometry)).toEqual([]);});
