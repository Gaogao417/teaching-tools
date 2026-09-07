/** Real React/Canvas/visual port lifecycle; only JSXGraph board drawing is stubbed. */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect,it,vi } from 'vitest';
import { createWorkspaceCommitPort } from '../../presentationRuntime/workspaceCommitPort';
import { snapshot,visual } from '../../presentationRuntime/__tests__/visualRuntimeTestSupport';
import type { TopicGeometryModel } from '../../../../../shared/topicPractice';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const {mount,destroy}=vi.hoisted(()=>({mount:vi.fn(),destroy:vi.fn()}));
vi.mock('../../../geometry/react/jsxgraph-board',()=>({mountGeometryBoard:(...args:unknown[])=>{mount(...args);return {board:{getBoundingBox:()=>[0,100,100,0],objectsList:[],on:vi.fn(),off:vi.fn()},render:vi.fn(),destroy,getPointer:()=>null};}}));
const {StudentWorkspaceViewSurface}=await import('../StudentWorkspaceViewSurface');
it('same full geometry in a fresh snapshot preserves surface and receipt; actual change remounts and rejects old receipt',async()=>{
 const width=vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(600),height=vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(400);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host),port=createWorkspaceCommitPort();
 const signal={...port,notifyRealSourceActive:vi.fn()};
 const geometry={viewBox:{width:100,height:100},points:[{id:'pt-A',x:10,y:20}],segments:[]} as TopicGeometryModel;
 const view=snapshot(20).views.student_workspace_view;
 const request={sessionId:view.session_id,executionKey:'static:test',visualRevision:visual.visual_revision,targetDigest:visual.digest,operation:'installed' as const,abort:new AbortController().signal};
 try {
  await act(async()=>root.render(<StudentWorkspaceViewSurface view={view} geometry={geometry} commitSignal={signal}/>));
  const generation=port.visualRenderer.generation()!;
  await port.visualRenderer.render(visual,request);expect(port.visualRenderer.isReady(visual)).toBe(true);
  await act(async()=>root.render(<StudentWorkspaceViewSurface view={structuredClone(view)} geometry={structuredClone(geometry)} commitSignal={signal}/>));
  expect(mount).toHaveBeenCalledTimes(1);expect(port.visualRenderer.generation()).toBe(generation);expect(port.visualRenderer.isReady(visual)).toBe(true);
  const changed=structuredClone(geometry);changed.points[0].x++;
  await act(async()=>root.render(<StudentWorkspaceViewSurface view={structuredClone(view)} geometry={changed} commitSignal={signal}/>));
  expect(mount).toHaveBeenCalledTimes(2);expect(destroy).toHaveBeenCalledTimes(1);expect(port.visualRenderer.generation()).not.toBe(generation);expect(port.visualRenderer.isReady(visual)).toBe(false);
  const abort=new AbortController();const waiting=port.visual.wait({...request,surfaceGeneration:port.visualRenderer.generation()!},{abort:abort.signal});
  port.visual.notifyCommitted({...request,surfaceGeneration:generation});abort.abort();expect(await waiting).toEqual({status:'aborted'});expect(port.visualRenderer.isReady(visual)).toBe(false);
 }finally{await act(async()=>root.unmount());host.remove();width.mockRestore();height.mockRestore();}
});
