import {sql} from 'drizzle-orm';
import {demand,uuid,Problem} from '../db.js';
import {calendar,overlap} from './providers.js';

async function details(st,id){
  return st.one(sql`select b.id,b.status,b.call_id as call,b.slot_id as "slotId",b.target_slot as target,b.calendar_event_id as "eventId",
    s.starts_at as start,s.ends_at as "end",l.details->>'name' as name from rental_bookings b
    join rental_slots s on (s.portfolio_id,s.id)=(b.portfolio_id,coalesce(b.target_slot,b.slot_id))
    join rental_listings l on (l.portfolio_id,l.id)=(s.portfolio_id,s.listing_id) where b.id=${id}`);
}
export async function openSlots(st,env,listingId){
  const [slots,s]=await Promise.all([st.all(sql`select s.id,starts_at as start,ends_at as "end" from rental_slots s join rental_listings l on
    (s.portfolio_id,s.listing_id)=(l.portfolio_id,l.id) where s.listing_id=${uuid(listingId)} and l.details->>'availability'='Available'
    and s.holder is null and s.starts_at>now() and s.starts_at<now()+interval '90 days' order by s.starts_at limit 100`),st.config()]);
  if(!slots.length)return {slots:[]};
  const provider=await calendar(env);
  const blocks=await provider.busy(slots[0].start,slots.at(-1).end);
  return {slots:slots.filter(slot=>!blocks.some(b=>overlap(b,slot))).slice(0,20).map(slot=>({...slot,timezone:s.timezone}))};
}
export async function reconcile(st,env,id){
  const b=await details(st,uuid(id));demand(b,404,'Booking not found.');
  if(b.status==='confirmed')return {status:'confirmed',calendarEventId:b.eventId};
  if(['cancelled','conflict'].includes(b.status))return {status:b.status};
  const lease=crypto.randomUUID();
  const claim=await st.one(sql`update rental_bookings set op_lease=${lease},op_until=now()+interval '90 seconds' where id=${id}
    and status=${b.status} and (op_lease is null or op_until<=now()) returning id`);
  demand(claim,503,'Another calendar request is in progress. Recheck the booking.');
  try{return await applyBooking(st,env,id,b,lease);}
  finally{await st.all(sql`update rental_bookings set op_lease=null,op_until=null where id=${id} and op_lease=${lease}`);}
}
async function applyBooking(st,env,id,b,lease){
  const provider=await calendar(env);
  if(b.status==='cancel_pending'){
    await provider.cancel(id,b.eventId);
    await st.batch([sql`update rental_bookings set status='cancelled',updated_at=now() where id=${id} and op_lease=${lease} and status='cancel_pending'`,
      sql`update rental_slots set holder=null where holder=${id} and exists(select 1 from rental_bookings where id=${id} and status='cancelled')`,
      st.out('cancel:'+id,'landlord.notify',b.call)],true);
    return {status:'cancelled'};
  }
  const moving=b.status==='move_pending';
  let eventId;
  try{eventId=await provider.place(id,b,b.name,moving);}
  catch(error){
    if(error.status===409){
      await st.batch([sql`update rental_slots set holder=null where id=${b.target||b.slotId} and holder=${id}
        and exists(select 1 from rental_bookings where id=${id} and op_lease=${lease} and status=${b.status})`,
        sql`update rental_bookings set status=${moving?'confirmed':'conflict'},target_slot=null,updated_at=now() where id=${id} and op_lease=${lease} and status=${b.status}`],true);
    }
    throw error;
  }
  const finalSlot=b.target||b.slotId;
  const queries=[sql`update rental_bookings set status='confirmed',calendar_event_id=${eventId},slot_id=${finalSlot},target_slot=null,updated_at=now()
    where id=${id} and op_lease=${lease} and status=${b.status} and coalesce(target_slot,slot_id)=${finalSlot} returning id`];
  if(moving)queries.push(sql`update rental_slots set holder=null where id=${b.slotId} and holder=${id}
    and exists(select 1 from rental_bookings where id=${id} and slot_id=${finalSlot} and status='confirmed')`);
  queries.push(sql`update rental_leads set stage='Showing booked',crm_status='Pending',updated_at=now() where id=(select lead_id from rental_bookings where id=${id} and status='confirmed')`,
    st.out('book:'+id+':'+finalSlot,'crm.upsert',b.call),st.out('show:'+id+':'+finalSlot,'landlord.notify',b.call));
  await st.batch(queries,true);
  const check=await details(st,id);
  demand(check?.status==='confirmed'&&check.slotId===finalSlot&&check.eventId===eventId,503,'The booking is being reconciled.');
  return {status:'confirmed',calendarEventId:eventId};
}
export async function book(st,env,call,b){
  demand(b.confirmed===true,400,'Read back the property and time and obtain confirmation first.');
  const x=await st.one(sql`select * from rental_hold(${st.portfolio}::uuid,${call},${uuid(b.slotId)}::uuid)`);
  demand(x.code!=='need_contact',422,'Save confirmed contact details before booking.');
  demand(x.booking,409,'That showing time is unavailable.');
  return reconcile(st,env,x.booking);
}
export async function changeBooking(st,env,b){
  const id=uuid(b.id);demand(b.confirmed===true,400,'Confirm the requested change first.');
  const [row]=await st.all(sql`select status,slot_id as "slotId",target_slot as target from rental_bookings where id=${id}`);
  demand(row,404,'Booking not found.');
  if(b.action==='cancel'){
    if(row.status==='cancelled')return {status:'cancelled'};
    demand(['confirmed','cancel_pending'].includes(row.status),409,'Reconcile the pending change first.');
    const result=await st.one(sql`update rental_bookings set status='cancel_pending',updated_at=now() where id=${id} and status in ('confirmed','cancel_pending') returning id`);
    demand(result,409,'Booking changed. Refresh the calendar.');
  }else if(b.action==='move'){
    const slot=uuid(b.slotId);
    if(row.status==='confirmed'&&row.slotId===slot)return reconcile(st,env,id);
    if(row.status==='move_pending'&&row.target===slot)return reconcile(st,env,id);
    demand(row.status==='confirmed',409,'Reconcile the pending change first.');
    const [claimed]=await st.batch([sql`with reserved as (
      update rental_slots s set holder=${id} from rental_bookings b,rental_slots orig,rental_listings l
      where s.id=${slot} and s.holder is null and s.starts_at>now() and b.id=${id} and b.status='confirmed'
      and orig.id=b.slot_id and orig.listing_id=s.listing_id and l.id=s.listing_id and l.details->>'availability'='Available' returning s.id)
      update rental_bookings set status='move_pending',target_slot=${slot},updated_at=now() where id=${id} and exists(select 1 from reserved) returning id`],true);
    demand(claimed.length,409,'The replacement time is unavailable.');
  }else throw new Problem(400,'Choose cancel or reschedule.');
  return reconcile(st,env,id);
}
