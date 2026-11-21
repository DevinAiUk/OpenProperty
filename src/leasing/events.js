import {sql} from 'drizzle-orm';
import {demand,field,uuid,hash,Problem} from '../db.js';
import {optional,email,phone,preferences,matches} from './validation.js';
import {parse} from './store.js';
import {book,openSlots} from './booking.js';
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export const safeId=(v,label)=>{const id=field(v,160,label);demand(/^[\w.:-]+$/.test(id),400,'Check '+label+'.');return id;};
export async function command(st,env,source,message){
  const {action,input={}}=message;
  const call=safeId(message.callId,'call identifier'),event=source+':'+safeId(message.eventId,'event identifier');
  demand(input&&typeof input==='object'&&!Array.isArray(input),400,'Invalid tool input.');
  const digest=await hash(JSON.stringify(stable({call,action,input}))),lease=crypto.randomUUID();
  const claim=await st.one(sql`insert into rental_receipts(portfolio_id,event_id,digest,lease,expires_at)
    values(${st.portfolio},${event},${digest},${lease},now()+interval '90 seconds') on conflict(portfolio_id,event_id)
    do update set lease=excluded.lease,expires_at=excluded.expires_at where rental_receipts.digest=excluded.digest
    and rental_receipts.result is null and rental_receipts.expires_at<=now() returning lease`);
  if(!claim){
    const prior=await st.one(sql`select digest,result::text from rental_receipts where event_id=${event}`);
    demand(prior?.digest===digest,409,'Event identifier was reused with different data.');
    if(prior.result)return parse(prior.result);
    throw new Problem(503,'The first request is still processing.');
  }
  try{
    const result=await run(st,env,call,event,action,input);
    await st.all(sql`update rental_receipts set result=${JSON.stringify(result)}::jsonb where event_id=${event} and lease=${lease}`);
    return result;
  }catch(e){
    await st.all(sql`update rental_receipts set expires_at=now() where event_id=${event} and lease=${lease}`);throw e;
  }
}
async function run(st,env,call,event,action,b){
  if(action==='lookup_listings'){
    const pref=preferences({...b,budget:b.maxRent}),all=await st.listings();
    const selected=b.listingId?all.filter(l=>l.id===uuid(b.listingId)):all.filter(l=>matches(l,{...pref,maxRent:pref.budget}));
    return {listings:selected.slice(0,25).map(({longPlan,shortPlan,photo,...approved})=>approved)};
  }
  if(action==='available_slots')return openSlots(st,env,b.listingId);
  if(action==='book_showing')return book(st,env,call,b);
  if(action==='capture_inquiry'){
    demand(b.confirmed===true,400,'Read back contact information and ask for permission to save.');
    const n=field(b.name,120,'caller name'),e=email(b.email),ph=phone(b.phone),prefs=preferences(b);
    demand(e||ph,422,'A confirmed phone number or email is required.');
    if(prefs.listingId)demand(await st.one(sql`select id from rental_listings where id=${prefs.listingId}`),404,'Listing not found.');
    const r=await st.one(sql`with captured as materialized (select rental_capture(${st.portfolio}::uuid,${call},${n},${e},${ph},${JSON.stringify(prefs)}::jsonb) as id),
      queued as (insert into rental_outbox(portfolio_id,event_id,kind,call_id) select ${st.portfolio},${event+':crm'},'crm.upsert',${call} from captured where id<>'review' on conflict do nothing)
      select id from captured`);
    demand(r.id!=='review',409,'Contact details need human review.');
    return {saved:true};
  }
  const create=sql`insert into rental_calls(portfolio_id,id) values(${st.portfolio},${call}) on conflict do nothing`;
  if(action==='request_callback'){
    const reason=field(b.reason,600,'callback reason'),ph=phone(b.phone),e=email(b.email);
    const [,r]=await st.batch([create,sql`with contact as (select coalesce(${ph},l.phone) as phone,coalesce(${e},l.email) as email from rental_calls c
      left join rental_leads l on l.id=c.lead_id where c.id=${call})
      insert into rental_callbacks(portfolio_id,call_id,reason,phone,email,status)
      select ${st.portfolio},${call},${reason},phone,email,case when phone is null and email is null then 'needs_contact' else 'requested' end from contact
      on conflict(portfolio_id,call_id) do update set reason=excluded.reason,phone=coalesce(excluded.phone,rental_callbacks.phone),email=coalesce(excluded.email,rental_callbacks.email),
      status=case when coalesce(excluded.phone,rental_callbacks.phone,excluded.email,rental_callbacks.email) is null then 'needs_contact' else 'requested' end returning status`,
      st.out(event+':handoff','handoff.notify',call)],true);
    return {status:r[0].status};
  }
  if(action==='summarize_call'||action==='end_call'){
    const summary=optional(b.summary,1600,'call summary'),nextAction=optional(b.nextAction,500,'next action');
    if(action==='summarize_call')demand(summary&&nextAction,400,'Supply a summary and the next action.');
    await st.batch([create,sql`update rental_calls set summary=case when ${summary}<>'' and (${action}='summarize_call' or summary='') then ${summary} else summary end,
      next_action=case when ${nextAction}<>'' and (${action}='summarize_call' or next_action='') then ${nextAction} else next_action end,
      ended=ended or ${action==='end_call'} where id=${call}`,
      ...(action==='end_call'?[sql`update rental_calls set
        summary=case when summary<>'' then summary when exists(select 1 from rental_bookings where call_id=${call} and status='confirmed') then 'Caller selected a calendar-confirmed showing.'
          when lead_id is not null then 'The caller provided rental preferences and contact details.' else 'Call ended without a completed lead intake.' end,
        next_action=case when next_action<>'' then next_action when exists(select 1 from rental_callbacks where call_id=${call}) then 'Review the callback request.'
          when exists(select 1 from rental_bookings where call_id=${call} and status='confirmed') then 'Prepare for the scheduled showing.' else 'Review the inquiry.' end where id=${call}`]:[]),
      sql`insert into rental_outbox(portfolio_id,event_id,kind,call_id) select ${st.portfolio},${event+':crm'},'crm.upsert',id from rental_calls
        where id=${call} and lead_id is not null on conflict do nothing`,
      ...(action==='end_call'?[st.out('ended:'+call,'landlord.notify',call)]:[])],true);
    return {saved:true};
  }
  throw new Problem(400,'Unknown rental action.');
}
