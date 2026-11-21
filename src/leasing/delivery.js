import {sql} from 'drizzle-orm';
import {database,uuid,demand} from '../db.js';
import {store,parse,bookingQuery} from './store.js';
import {pushDelivery} from './providers.js';
import {reconcile} from './booking.js';
export function bound(env,p){return Boolean(p&&env.SILL_LEASING_PORTFOLIO_ID===p);}
export async function deliverRental(st,env,limit=8){
  if(!bound(env,st.portfolio))return {processed:0};
  const settings=await st.config(); let processed=0;
  for(let i=0;i<limit;i++){
    const lease=crypto.randomUUID();
    const row=await st.one(sql`update rental_outbox set status='sending',lease=${lease},due_at=now()+interval '2 minutes',attempts=attempts+1
      where (portfolio_id,event_id)=(select portfolio_id,event_id from rental_outbox where status in ('pending','sending') and due_at<=now()
      order by created_at,event_id limit 1 for update skip locked) returning event_id as id,kind,call_id as call,attempts`);
    if(!row)break;
    const isCrm=row.kind==='crm.upsert';
    try{
      const c=await st.one(sql`select c.lead_id as "leadId",c.summary,c.next_action as "nextAction",l.name,l.email,l.phone,l.preferences::text
        from rental_calls c left join rental_leads l on l.id=c.lead_id where c.id=${row.call}`);
      demand(c,503,'Call record needs review.');
      if(!isCrm&&!settings.notifyEnabled){
        await st.all(sql`update rental_outbox set status='disabled',lease=null,failure=null where event_id=${row.id} and lease=${lease}`);
        processed++;continue;
      }
      const booking=await st.one(sql`${bookingQuery} where b.call_id=${row.call} order by b.updated_at desc limit 1`);
      const callback=row.kind==='handoff.notify'?await st.one(sql`select reason,phone,email,status from rental_callbacks where call_id=${row.call}`):null;
      const payload={version:1,eventId:row.id,kind:row.kind,leadId:c.leadId,contact:{name:c.name||'',email:callback?.email||c.email,phone:callback?.phone||c.phone},
        preferences:parse(c.preferences||'{}'),summary:callback?.reason||c.summary,nextAction:callback?'Callback · '+callback.status:c.nextAction,
        booking:booking||null,notifyTo:isCrm?null:settings.notifyTo,crmMap:settings.crmMap};
      const receipt=await pushDelivery(env,settings,payload);
      const ack=sql`update rental_outbox set status='confirmed',receipt=${receipt},failure=null,lease=null where event_id=${row.id} and lease=${lease} returning call_id`;
      if(isCrm){
        await st.all(sql`with ack as (${ack}) update rental_leads set crm_status='Synced',crm_id=${receipt}
          where id=(select lead_id from rental_calls where id=(select call_id from ack))`);
      }else await st.all(ack);
    }catch(e){
      const state=row.attempts>=8?'failed':'pending',reason=e.status?e.message:'Delivery failed. Check the provider connection.';
      await st.all(sql`update rental_outbox set status=${state},failure=${reason},lease=null,due_at=now()+${Math.min(60,2**(row.attempts-1))}*interval '1 minute'
        where event_id=${row.id} and lease=${lease}`);
    }
    processed++;
  }return {processed};
}
export async function leasingTick(env){
  if(!env.SILL_LEASING_PORTFOLIO_ID||!env.DATABASE_URL)return;
  const st=store(database(env),uuid(env.SILL_LEASING_PORTFOLIO_ID));
  const pending=await st.all(sql`select id from rental_bookings where status in ('pending','cancel_pending','move_pending')
    and updated_at<now()-interval '2 minutes' order by updated_at limit 6`);
  for(const p of pending){try{await reconcile(st,env,p.id);}catch{await st.all(sql`update rental_bookings set updated_at=now() where id=${p.id}`);}}
  return deliverRental(st,env);
}
