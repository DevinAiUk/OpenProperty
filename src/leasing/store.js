import {sql} from 'drizzle-orm';
import {defaultSettings} from './validation.js';
export const parse=v=>typeof v==='string'?JSON.parse(v):v;
export const jsonVal=v=>JSON.stringify(v);
export function store(db,portfolio){
  async function batch(queries,lock=false){
    const setup=[sql`select set_config('sill.portfolio',${portfolio},true)`];
    if(lock)setup.push(sql`select pg_advisory_xact_lock(hashtext(${portfolio}))`);
    const result=await db.batch([...setup,...queries].map(q=>db.execute(q)));
    return result.slice(setup.length).map(r=>r.rows);
  }
  const all=async q=>(await batch([q]))[0];
  const one=async q=>(await all(q))[0];
  const config=async()=>({...defaultSettings,...parse((await one(sql`select settings::text as data from rental_settings`))?.data||'{}')});
  const listings=async()=> (await all(sql`select id,details::text,long_plan::text,short_plan::text from rental_listings order by details->>'name'`))
    .map(r=>({id:r.id,...parse(r.details),longPlan:parse(r.long_plan),shortPlan:parse(r.short_plan)}));
  const out=(key,kind,call)=>sql`insert into rental_outbox(portfolio_id,event_id,kind,call_id)
    values(${portfolio},${key},${kind},${call}) on conflict do nothing`;
  return {db,portfolio,batch,all,one,config,listings,out};
}
export const leadQuery=sql`select id,name,email,phone,preferences::text,stage,crm_status as "crmStatus",crm_id as "crmId",created_at as "createdAt" from rental_leads order by updated_at desc`;
export const bookingQuery=sql`select b.id,b.lead_id as "leadId",b.slot_id as "slotId",s.listing_id as "listingId",s.starts_at as start,s.ends_at as "end",b.status,b.calendar_event_id as "calendarEventId" from rental_bookings b join rental_slots s on s.portfolio_id=b.portfolio_id and s.id=b.slot_id`;
export async function snapshot(st){
  const [listings,settings,rows]=await Promise.all([st.listings(),st.config(),st.batch([
    leadQuery,sql`select id,lead_id as "leadId",summary,next_action as "nextAction",ended,created_at as "createdAt" from rental_calls order by created_at desc`,
    sql`${bookingQuery} order by s.starts_at`,
    sql`select id,listing_id as "listingId",starts_at as start,ends_at as "end",holder from rental_slots where ends_at>=now() order by starts_at`,
    sql`select listing_id as "listingId",month,amounts::text from rental_actuals order by month desc`,
    sql`select call_id as "callId",reason,phone,email,status from rental_callbacks order by created_at desc`,
    sql`select event_id as "eventId",kind,status,attempts,failure,receipt,created_at as "createdAt" from rental_outbox order by created_at desc limit 200`
  ])]);
  const [leads,calls,bookings,slots,actuals,callbacks,deliveries]=rows;
  return {listings,settings,leads:leads.map(l=>({...l,preferences:parse(l.preferences)})),calls,bookings,slots,
    actuals:actuals.map(a=>({...a,amounts:parse(a.amounts)})),callbacks,deliveries};
}
