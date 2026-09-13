import test from 'node:test';
import assert from 'node:assert/strict';
import {agencyIntegration} from '../agency-integration.ts';
import type {Store,Event} from '../model.ts';
function memory():Store {const data=new Map<string,unknown>();return {get:k=>structuredClone(data.get(k)) as any,put:(k,v)=>{data.set(k,structuredClone(v));},del:k=>{data.delete(k);},list:p=>[...data].filter(([k])=>k.startsWith(p)).map(([key,value])=>({key,value:structuredClone(value) as any})),atomic:fn=>fn()};}
const payload={deliveryId:'run:1',projectId:'proj_demo',jobId:'AG-102',title:'Review result',kind:'question_link' as const};
test('requires explicit enable and a bound project topic',()=>{const api=agencyIntegration(memory());assert.throws(()=>api.enqueue(payload,false),/disabled/);assert.throws(()=>api.enqueue(payload,true),/topic_required/);});
test('deduplicates delivery and rejects reuse with different content',()=>{const s=memory();s.put('topic:proj_demo',{key:'proj_demo',name:'Demo',threadId:42,creating:false});const api=agencyIntegration(s);assert.equal(api.enqueue(payload,true).duplicate,false);assert.equal(api.enqueue(payload,true).duplicate,true);assert.equal(s.list('queue:').length,1);assert.throws(()=>api.enqueue({...payload,title:'different'},true),/conflict/);assert.equal(s.get<Event>('queue:agency:run:1')?.agencyTopicId,42);s.put('sent:agency:run:1',{at:Date.now()});s.del('queue:agency:run:1');assert.equal(api.status('run:1').state,'delivered');});
test('rejects arbitrary recipient and secret payload fields',()=>{const api=agencyIntegration(memory());assert.throws(()=>api.enqueue({...payload,chatId:123},true));assert.throws(()=>api.enqueue({...payload,values:{API_KEY:'test'}},true));});
