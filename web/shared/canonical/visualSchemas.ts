/** PRDS geometry visual G0 mirror. Existing codecs remain immutable readers. */
import { z } from 'zod';
import { tutorPlanBundleV7Schema, workspaceRuntimeStateV2Schema, studentWorkspaceViewV2Schema, tutorRuntimeStateV4Schema, presentationPlanV4Schema, presentationDeliveryV1Schema, presentationOutcomeV1Schema, studentInputV1Schema, tutorSessionEventV9Schema } from './schemas';
const s = z.string().min(1), n = z.number().int().min(0), p = z.number().int().min(1);
const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const issue = (ctx:z.RefinementCtx,message:string) => ctx.addIssue({code:z.ZodIssueCode.custom,message});
export const visualActionKeySchema=z.object({session_id:s,sequence_id:s,ordinal:n,action_id:s}).strict();
export const visualExecutionOwnerSchema=z.object({client_instance_id:z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),epoch:p}).strict();
export const visualScopeSchema=presentationPlanV4Schema.innerType().shape.scope;
export const visualOwnerSchema=z.object({scope:visualScopeSchema,scope_epoch:p,part_ref:s,group_id:s.optional()}).strict();
export const visualAngleSchema=z.object({vertex:s,ray_points:z.tuple([s,s]),sector:z.literal('minor')}).strict().superRefine((v,c)=>{if(new Set([v.vertex,...v.ray_points]).size!==3)issue(c,'angle requires three distinct points');});
const endpoints=z.tuple([s,s]).refine(v=>v[0]!==v[1],'segment requires distinct endpoints');
const triangle=z.tuple([s,s,s]).superRefine((v,c)=>{if(new Set(v).size!==3)issue(c,'triangle requires distinct vertices');});
export const visualRelationSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('angle-equality'),angles:z.tuple([visualAngleSchema,visualAngleSchema])}).strict(),
 z.object({type:z.literal('similarity'),left:triangle,right:triangle,proof_angle_bindings:z.array(s)}).strict(),
 z.object({type:z.literal('segment-measure'),segment:s,expression_ref:s}).strict(),
 z.object({type:z.literal('directed-ratio'),numerator:s,denominator:s,expression_ref:s}).strict(),
]);
export const visualFormSchema=z.enum(['angle-arcs','paired-sides','triangle-outline','length-label','ratio-label']);
export const visualLifetimeSchema=z.enum(['explanation-group','teaching-scope','problem-part']);
export const visualBindingSchema=z.object({binding_id:z.string().regex(/^VB-[0-9]{1,3}$/),binding_kind:z.literal('geometry_visual'),purpose:s,relation:visualRelationSchema,basis_refs:z.array(s).min(1),allowed_scopes:z.array(visualScopeSchema).min(1),reveal_scope:z.enum(['target_highlight','intermediate_result','final_result']),required_constructions:z.array(s),allowed_forms:z.array(visualFormSchema).min(1),max_lifetime:visualLifetimeSchema}).strict().superRefine((v,c)=>{
 const allowed={ 'angle-equality':['angle-arcs'],'similarity':['paired-sides','triangle-outline'],'segment-measure':['length-label'],'directed-ratio':['ratio-label']}[v.relation.type];
 if(v.allowed_forms.some(f=>!allowed.includes(f)))issue(c,'visual form incompatible with approved relation');
 if(new Set(v.allowed_forms).size!==v.allowed_forms.length)issue(c,'duplicate visual form');
});
export const visualRequirementSchema=z.object({scope:visualScopeSchema,binding_ref:s,forms:z.array(visualFormSchema).min(1),required_pair_indices:z.array(z.union([z.literal(0),z.literal(1),z.literal(2)])),trigger:z.enum(['introduce','use-in-reasoning','clarify-reference'])}).strict();
export const visualTargetsSchema=z.object({entity_ids:z.array(s).min(1),angles:z.array(visualAngleSchema).optional(),triangles:z.object({left:triangle,right:triangle}).strict().optional(),paired_sides:z.tuple([z.object({endpoints:endpoints}).strict(),z.object({endpoints:endpoints}).strict()]).optional()}).strict();
export const visualLeaseSchema=z.object({lease_id:s,owner:visualOwnerSchema,lifetime:visualLifetimeSchema,status:z.enum(['active','suspended','retired']),version:p,introduced_by:visualActionKeySchema,last_changed_by:visualActionKeySchema}).strict();
export const visualAnnotationSchema=z.object({annotation_id:s,semantic_key:s,binding_ref:s,form:visualFormSchema,role_key:s,content_ref:s.optional(),resolved_targets:visualTargetsSchema,version:p,leases:z.array(visualLeaseSchema).min(1),introduced_by:visualActionKeySchema,last_changed_by:visualActionKeySchema}).strict();
export const visualFocusSchema=z.object({binding_ref:s,pair_index:z.union([z.literal(0),z.literal(1),z.literal(2)]).optional(),mode:z.enum(['steady','pulse']),resolved_targets:visualTargetsSchema}).strict();
export const visualGroupSchema=z.object({group_id:s,owner:visualOwnerSchema,status:z.enum(['active','closed']),focus:visualFocusSchema.nullable(),opened_by:visualActionKeySchema,closed_by:visualActionKeySchema.optional()}).strict();
export const visualStateSchema=z.object({visual_revision:n,annotations:z.array(visualAnnotationSchema),groups:z.array(visualGroupSchema),active_group_id:s.nullable()}).strict().superRefine((v,c)=>{
 if(new Set(v.annotations.map(a=>a.annotation_id)).size!==v.annotations.length||new Set(v.groups.map(g=>g.group_id)).size!==v.groups.length)issue(c,'duplicate visual identity');
 const active=v.groups.filter(g=>g.status==='active');if(active.length>1|| (v.active_group_id===null ? active.length!==0 : active.length!==1||active[0].group_id!==v.active_group_id))issue(c,'active visual group mismatch');
 for(const a of v.annotations)if(new Set(a.leases.map(l=>l.lease_id)).size!==a.leases.length)issue(c,'duplicate lease');
});
export const visualAnnotationViewSchema=z.object({annotation_id:s,binding_ref:s,form:visualFormSchema,role_key:s,resolved_targets:visualTargetsSchema,content:s.optional(),version:p,owner_keys:z.array(s).min(1)}).strict();
export const visualFocusViewSchema=visualFocusSchema.extend({group_id:s,owner_key:s}).strict();
export const visualViewSchema=z.object({visual_revision:n,annotations:z.array(visualAnnotationViewSchema),focus:visualFocusViewSchema.nullable(),digest:hash}).strict();
const barrierBase={barrier_id:s,cause:z.enum(['barge-in','scope-transition','completion','recovery','claim']),execution_owner:visualExecutionOwnerSchema,control_request_id:s,supersedes_barrier_id:s.optional()};
export const visualBarrierSchema=z.union([
 z.object({...barrierBase,status:z.literal('awaiting-control')}).strict(),
 z.object({...barrierBase,control_request_id:s.optional(),status:z.enum(['awaiting-cleanup','failed']),cleanup_sequence_id:s,target_event_sequence:p,catalog_hash:hash,target_visual_revision:n,target_digest:hash}).strict(),
]);
export const visualBarrierViewSchema=z.object({schema:z.literal('ai_teaching_visual_barrier_view/v1'),execution_owner:visualExecutionOwnerSchema,barrier:visualBarrierSchema.nullable()}).strict();
const cmd={schema:z.literal('ai_teaching_geometry_visual_command/v1')};
export const geometryVisualCommandSchema=z.discriminatedUnion('op',[
 z.object({...cmd,op:z.literal('upsert'),annotation_id:s,semantic_key:s,expected_version:n,binding_ref:s,form:visualFormSchema,role_key:s,content_ref:s.optional(),resolved_targets:visualTargetsSchema,owner:visualOwnerSchema,lifetime:visualLifetimeSchema}).strict(),
 z.object({...cmd,op:z.literal('focus'),group_id:s,owner:visualOwnerSchema,binding_ref:s,pair_index:z.union([z.literal(0),z.literal(1),z.literal(2)]).optional(),mode:z.enum(['steady','pulse']),resolved_targets:visualTargetsSchema}).strict(),
 z.object({...cmd,op:z.literal('close-group'),group_id:s,owner:visualOwnerSchema}).strict(),
 z.object({...cmd,op:z.literal('reconcile'),barrier_id:s,target_visual_revision:n,target_digest:hash}).strict(),
]);
const oldBinding=tutorPlanBundleV7Schema.innerType().shape.resource_bindings.element;
export const tutorPlanBundleV8Schema=tutorPlanBundleV7Schema.innerType().extend({schema:z.literal('ai_teaching_tutor_plan_bundle/v8'),resource_bindings:z.array(z.union([oldBinding,visualBindingSchema])),visual_requirements:z.array(visualRequirementSchema)}).strict().superRefine((v,c)=>{
 const {visual_requirements,...base}=v;
 const legacy=tutorPlanBundleV7Schema.safeParse({...base,schema:'ai_teaching_tutor_plan_bundle/v7',resource_bindings:v.resource_bindings.filter(b=>b.binding_kind!=='geometry_visual')});
 if(!legacy.success)for(const e of legacy.error.issues)c.addIssue(e);
 if(new Set(v.resource_bindings.map(b=>b.binding_id)).size!==v.resource_bindings.length)issue(c,'duplicate binding');
 const bindings=new Map(v.resource_bindings.map(b=>[b.binding_id,b]));
 for(const r of visual_requirements){const b=bindings.get(r.binding_ref);if(!b||b.binding_kind!=='geometry_visual'||r.forms.some(f=>!b.allowed_forms.includes(f)))issue(c,'unbound visual requirement');}
});
export const workspaceRuntimeStateV3Schema=workspaceRuntimeStateV2Schema.extend({schema:z.literal('ai_teaching_workspace_runtime_state/v3'),geometry:workspaceRuntimeStateV2Schema.shape.geometry.extend({visual_state:visualStateSchema}).strict()}).strict();
export const studentWorkspaceViewV3Schema=studentWorkspaceViewV2Schema.extend({schema:z.literal('ai_teaching_student_workspace_view/v3'),canvas:studentWorkspaceViewV2Schema.shape.canvas.extend({visual:visualViewSchema}).strict()}).strict();
export const tutorRuntimeStateV5Schema=tutorRuntimeStateV4Schema.innerType().extend({schema:z.literal('ai_teaching_tutor_runtime_state/v5'),visual_barrier:visualBarrierSchema.nullable(),scope_epoch:n,presentation_execution_owner:visualExecutionOwnerSchema}).strict().superRefine((v,c)=>{const {visual_barrier,scope_epoch,presentation_execution_owner,...base}=v;const r=tutorRuntimeStateV4Schema.safeParse({...base,schema:'ai_teaching_tutor_runtime_state/v4'});if(!r.success)for(const e of r.error.issues)c.addIssue(e);if(visual_barrier&&JSON.stringify(visual_barrier.execution_owner)!==JSON.stringify(presentation_execution_owner))issue(c,'barrier execution owner mismatch');});
export const presentationPlanV5Schema=presentationPlanV4Schema.innerType().extend({schema:z.literal('ai_teaching_presentation_plan/v5'),purpose:z.enum(['teaching','visual-reconcile'])}).strict().superRefine((v,c)=>{
 const {purpose,...base}=v;const r=presentationPlanV4Schema.safeParse({...base,schema:'ai_teaching_presentation_plan/v4'});if(!r.success)for(const e of r.error.issues)c.addIssue(e);
 if(purpose==='visual-reconcile'&&(v.generation||v.actions.length!==1||v.actions[0].workspace_action?.capability!=='geometry.visual.reconcile'))issue(c,'reconcile must be a single system cleanup action');
 for(const a of v.actions){const w=a.workspace_action;if(w?.capability.startsWith('geometry.visual.')){try{const command=geometryVisualCommandSchema.parse(JSON.parse(w.command_payload??''));if(w.capability!==`geometry.visual.${command.op}`)issue(c,'visual op/capability mismatch');if(command.op==='reconcile'&&purpose!=='visual-reconcile')issue(c,'model cannot authorize reconcile');}catch{issue(c,'invalid typed visual command');}}}
});
export const presentationDeliveryV2Schema=presentationDeliveryV1Schema.innerType().extend({schema:z.literal('ai_teaching_presentation_delivery/v2'),execution_owner:visualExecutionOwnerSchema}).strict().superRefine((v,c)=>{const {execution_owner,...base}=v;const r=presentationDeliveryV1Schema.safeParse({...base,schema:'ai_teaching_presentation_delivery/v1'});if(!r.success)for(const e of r.error.issues)c.addIssue(e);});
export const presentationOutcomeV2Schema=presentationOutcomeV1Schema.innerType().extend({schema:z.literal('ai_teaching_presentation_outcome/v2'),execution_owner:visualExecutionOwnerSchema,hold_for_control:z.object({client_request_id:s}).strict().optional()}).strict().superRefine((v,c)=>{const {execution_owner,hold_for_control,...base}=v;const r=presentationOutcomeV1Schema.safeParse({...base,schema:'ai_teaching_presentation_outcome/v1'});if(!r.success)for(const e of r.error.issues)c.addIssue(e);});
const inputV2Body=studentInputV1Schema.shape.input.innerType().extend({command:studentInputV1Schema.shape.input.innerType().shape.command.unwrap().or(z.literal('claim_presentation')).optional(),not_started_delivery:z.object({sequence_id:s,ordinal:n,action_id:s}).strict().optional()}).strict().superRefine((v,c)=>{const {not_started_delivery,...base}=v;const r=studentInputV1Schema.shape.input.safeParse({...base,...(base.command==='claim_presentation'?{command:'barge_in'}:{})});if(!r.success)for(const e of r.error.issues)c.addIssue(e);if(not_started_delivery&&(v.kind!=='control'||v.command!=='barge_in'))issue(c,'not_started_delivery requires barge_in');});
export const studentInputV2Schema=studentInputV1Schema.extend({schema:z.literal('ai_teaching_student_input/v2'),execution_owner:visualExecutionOwnerSchema,input:inputV2Body}).strict();
export const visualInvalidationSchema=z.object({reason:z.enum(['barge-in','scope-transition','completion','recovery','claim']),owner_keys:z.array(s),group_ids:z.array(s),lease_ids:z.array(s),rollback_action_keys:z.array(visualActionKeySchema),resulting_visual_revision:n,resulting_workspace_revision:n}).strict();
const newEvents:Record<string,z.ZodTypeAny>={visual_barrier_changed:z.object({previous_barrier_id:s.nullable(),barrier:visualBarrierSchema.nullable()}).strict(),presentation_execution_claimed:z.object({previous_owner:visualExecutionOwnerSchema.nullable(),execution_owner:visualExecutionOwnerSchema,client_request_id:s,request_hash:hash}).strict(),workspace_visual_owners_invalidated:visualInvalidationSchema};
export const tutorSessionEventV10Schema=tutorSessionEventV9Schema.innerType().extend({schema:z.literal('ai_teaching_tutor_session_event/v10')}).strict().superRefine((v,c)=>{
 const payload=v.payload as Record<string,unknown>;
 const test=(r:z.SafeParseReturnType<unknown,unknown>)=>{if(!r.success)for(const e of r.error.issues)c.addIssue(e);};
 if(newEvents[v.event_type]){test(newEvents[v.event_type].safeParse(payload));if(v.causation_sequence===undefined)issue(c,'visual event requires causation');return;}
 const base={...v,schema:'ai_teaching_tutor_session_event/v9',payload:{...payload}};
 if(v.event_type==='presentation_sequence_planned'){test(presentationPlanV5Schema.safeParse({...payload,schema:'ai_teaching_presentation_plan/v5',session_id:v.session_id}));delete base.payload.purpose;}
 if(v.event_type==='session_started'){test(visualExecutionOwnerSchema.safeParse(payload.presentation_execution_owner));delete base.payload.presentation_execution_owner;}
 if(v.event_type==='student_input_recorded'&&payload.input){test(inputV2Body.safeParse(payload.input));const input={...(payload.input as Record<string,unknown>)};delete input.not_started_delivery;if(input.command==='claim_presentation')input.command='barge_in';base.payload.input=input;}
 if(v.event_type==='presentation_sequence_superseded'&&['superseded-before-start','execution-revoked'].includes(String(payload.reason)))base.payload.reason='interrupted';
 test(tutorSessionEventV9Schema.safeParse(base));
});
export type VisualActionKey=z.infer<typeof visualActionKeySchema>;
export type VisualExecutionOwner=z.infer<typeof visualExecutionOwnerSchema>;
export type VisualOwner=z.infer<typeof visualOwnerSchema>;
export type VisualBinding=z.infer<typeof visualBindingSchema>;
export type VisualRequirement=z.infer<typeof visualRequirementSchema>;
export type VisualCommand=z.infer<typeof geometryVisualCommandSchema>;
export type VisualState=z.infer<typeof visualStateSchema>;
export type VisualLease=z.infer<typeof visualLeaseSchema>;
export type VisualAnnotation=z.infer<typeof visualAnnotationSchema>;
export type VisualGroup=z.infer<typeof visualGroupSchema>;
export type VisualView=z.infer<typeof visualViewSchema>;
export type VisualAnnotationView=z.infer<typeof visualAnnotationViewSchema>;
export type VisualFocusView=z.infer<typeof visualFocusViewSchema>;
export type VisualBarrier=z.infer<typeof visualBarrierSchema>;
export type VisualInvalidation=z.infer<typeof visualInvalidationSchema>;
