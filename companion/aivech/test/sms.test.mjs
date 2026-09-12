import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCodes,formatSms} from '../dist/sms.js';
import {createBot,OWNER_ID,BOT_ID} from '../dist/bot.js';

test('finds ordinary service codes and preserves leading zeroes',()=>{
  assert.deepEqual(extractCodes('Ваш код подтверждения: 001234. Никому не сообщайте.'),['001234']);
  assert.deepEqual(extractCodes('Google verification code: G-987654'),['987654']);
  assert.deepEqual(extractCodes('Код: 123-456'),['123456']);
  assert.deepEqual(extractCodes('562638'),['562638']);
});
test('does not offer phone numbers, dates and amounts as verification codes',()=>{
  assert.deepEqual(extractCodes('Код 1234. Телефон +7 (964) 384-89-35. Сумма 5000 руб. 12.09.2026'),['1234']);
  assert.deepEqual(extractCodes('Баланс 17000 руб. Звоните +7 964 384 8935'),[]);
});
test('untrusted SMS HTML is escaped; copy button contains only the code',()=>{
  const p=formatSms({id:1,fingerprint:'x',received:1,sender:'<b>Sender</b>',recipient:'+79990000000',text:'Код: 001234 <a href="https://evil.invalid">click</a>'});
  assert.match(p.text,/&lt;a href/);
  assert.match(p.text,/&lt;b&gt;Sender/);
  assert.equal(p.reply_markup.inline_keyboard[0][0].copy_text.text,'001234');
  assert.equal(p.link_preview_options.is_disabled,true);
});
test('owner filter blocks foreign users, groups and spoofed sender/chat combinations',async()=>{
  let replies=0;
  const bot=createBot('dummy',()=> 'private status');
  bot.api.config.use(async (_previous,method)=> {
    if(method==='getMe') return {ok:true,result:{id:BOT_ID,is_bot:true,first_name:'test',username:'aivech_bot'}};
    if(method==='sendMessage') {replies++;return {ok:true,result:{message_id:1,date:1,chat:{id:OWNER_ID,type:'private'},text:'ok'}};}
    throw new Error('Unexpected API method');
  });
  await bot.init();
  const update=(from,chat,type='private')=>({update_id:1,message:{message_id:1,date:1,from:{id:from,is_bot:false,first_name:'x'},chat:{id:chat,type},text:'/status',entities:[{type:'bot_command',offset:0,length:7}]}});
  await bot.handleUpdate(update(111,111));
  await bot.handleUpdate(update(OWNER_ID,-100,'supergroup'));
  await bot.handleUpdate(update(111,OWNER_ID));
  assert.equal(replies,0);
  await bot.handleUpdate(update(OWNER_ID,OWNER_ID));
  assert.equal(replies,1);
});
test('owner command replies stay inside the requesting topic',async()=>{
 const payloads=[];const bot=createBot('dummy',()=> 'status');
 bot.api.config.use(async(_p,method,payload)=>{
  if(method==='getMe')return {ok:true,result:{id:BOT_ID,is_bot:true,first_name:'test',username:'aivech_bot'}};
  if(method==='sendMessage'){payloads.push(payload);return {ok:true,result:{message_id:1,date:1,chat:{id:OWNER_ID,type:'private'},text:'ok'}};}
  throw new Error('Unexpected API method');
 });
 await bot.init();await bot.handleUpdate({update_id:55,message:{message_id:2,message_thread_id:888,date:1,from:{id:OWNER_ID,is_bot:false,first_name:'owner'},chat:{id:OWNER_ID,type:'private'},text:'/status',entities:[{type:'bot_command',offset:0,length:7}]}});
 assert.equal(payloads.length,1);assert.equal(payloads[0].message_thread_id,888);assert.equal(payloads[0].chat_id,OWNER_ID);
});
