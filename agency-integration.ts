import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Store, Topic, Event } from './model';
export const agencyDeliverySchema=z.object({deliveryId:z.string().regex(/^[a-zA-Z0-9_.:-]{1,160}$/),projectId:z.string().regex(/^proj_[a-zA-Z0-9_-]+$/),jobId:z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),title:z.string().trim().min(1).max(500),kind:z.enum(['notification','question_link'])}).strict();
export const agencyCapabilitySchema=z.object({version:z.literal(1),enabled:z.boolean(),actions:z.array(z.string()),events:z.array(z.string()),destinations:z.array(z.object({projectId:z.string(),name:z.string()}))});
export const agencyReceiptSchema=z.object({deliveryId:z.string(),state:z.enum(['queued','delivered','unknown']),duplicate:z.boolean()});
export function agencyIntegration(store:Store) {
 const prefix=(id:string)=>`agency:${id}`;
 return {
  capabilities(enabled:boolean){return {version:1 as const,enabled,actions:['telegram.notify','telegram.question_link'],events:['telegram.notification.delivered'],destinations:store.list<Topic>('topic:').filter(x=>x.value.key.startsWith('proj_')&&x.value.threadId!==null&&!x.value.creating).map(x=>({projectId:x.value.key,name:x.value.name}))};},
  status(deliveryId:string){const id=prefix(deliveryId);return {deliveryId,state:store.get('sent:'+id)?'delivered' as const:store.get('queue:'+id)?'queued' as const:'unknown' as const,duplicate:Boolean(store.get('agency-key:'+id))};},
  enqueue(raw:unknown,enabled:boolean){const data=agencyDeliverySchema.parse(raw);if(!enabled)throw Error('agency_integration_disabled');const topic=store.get<Topic>('topic:'+data.projectId);if(!topic?.threadId||topic.creating)throw Error('project_topic_required');const id=prefix(data.deliveryId);const hash=createHash('sha256').update(JSON.stringify(data)).digest('hex');const previous=store.get<{hash:string}>('agency-key:'+id);if(previous){if(previous.hash!==hash)throw Error('delivery_id_conflict');return this.status(data.deliveryId);}
   const event:Event={agencyTopicId:topic.threadId,id,projectId:data.projectId,taskId:data.jobId,key:data.jobId,title:data.title,tracker:'Агентство',status:data.kind==='question_link'?'in_review':'todo',kind:data.kind==='question_link'?'agency_question':'agency_notice',dueDate:null,at:new Date().toISOString(),urgent:data.kind==='question_link'};
   store.atomic(()=>{store.put('agency-key:'+id,{hash,at:Date.now()});store.put('queue:'+id,event);});return {deliveryId:data.deliveryId,state:'queued' as const,duplicate:false};
  },
 };
}
