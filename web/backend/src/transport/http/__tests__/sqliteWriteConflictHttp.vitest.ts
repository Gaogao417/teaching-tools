import express from 'express';
import Database from 'better-sqlite3';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createVNextTutorRoutes} from '../vnextTutorRoutes';
import type {TutorRuntimeApplicationV7} from '../../../services/tutorOrchestration/TutorRuntimeApplicationV7';
let failure:Error,requests=0;
let server:import('node:http').Server,base:string;
beforeAll(async()=>{
 const app=express();app.use(createVNextTutorRoutes({applicationFactory:()=>({restore(){requests++;throw failure;}} as unknown as TutorRuntimeApplicationV7)}));
 await new Promise<void>(resolve=>{server=app.listen(0,'127.0.0.1',()=>{base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;resolve();});});
});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
it.each(['SQLITE_BUSY','SQLITE_BUSY_SNAPSHOT'])('real driver %s maps to explicit write conflict without replay',async code=>{
 failure=new Database.SqliteError('database is locked',code);const before=requests;
 const response=await fetch(base+'/tutor-sessions/TS-984512001');expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:'REVISION_CONFLICT'}});expect(requests-before).toBe(1);
});
it.each(['SQLITE_IOERR','SQLITE_CORRUPT','SQLITE_LOCKED'])('driver %s is not broadened to contention',async code=>{
 failure=new Database.SqliteError('database is locked',code);
 const response=await fetch(base+'/tutor-sessions/TS-984512001');expect(response.status).toBe(500);expect(await response.json()).toMatchObject({error:{code:'INTERNAL_ERROR'}});
});
it('ordinary Error with matching name/code/message is not a driver conflict',async()=>{
 failure=Object.assign(new Error('database is locked'),{name:'SqliteError',code:'SQLITE_BUSY'});
 const response=await fetch(base+'/tutor-sessions/TS-984512001');expect(response.status).toBe(500);expect(await response.json()).toMatchObject({error:{code:'INTERNAL_ERROR'}});
});
