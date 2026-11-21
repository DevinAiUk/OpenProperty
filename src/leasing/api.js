import {sql} from 'drizzle-orm';
import {services,database,rows,uuid,demand,field,hash,Problem} from '../db.js';
import {store,snapshot} from './store.js';
import {listing,settings,amounts,instant,officeOpen} from './validation.js';
import {validMonth} from './finance.js';
import {command,safeId} from './events.js';
import {changeBooking,reconcile} from './booking.js';
import {bound,deliverRental} from './delivery.js';
import {calendarReady} from './providers.js';
const reply=(v,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
function status(env,p){
  const on=bound(env,p);
  return {scope:on,calendar:on&&calendarReady(env),vapi:on&&Boolean(env.VAPI_WEBHOOK_SECRET),make:on&&Boolean(env.MAKE_WEBHOOK_URL&&env.MAKE_WEBHOOK_KEY),
    commands:on&&Boolean(env.MAKE_COMMAND_SECRET),hubspot:on&&Boolean(env.HUBSPOT_TOKEN)};
}
async function machine(req,env,key){
  demand(env[key]&&env.SILL_LEASING_PORTFOLIO_ID,503,'This integration needs configuration.');
  const got=req.headers.get('authorization')||'',expected='Bearer '+env[key];
  const a=await hash(got),b=await hash(expected);let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);
  demand(!mismatch,401,'Invalid integration credential.');
  return store(database(env),uuid(env.SILL_LEASING_PORTFOLIO_ID));
}
async function vapi(st,env,m){
  const call=safeId(m?.call?.id,'call identifier');
  if(m.type==='transfer-destination-request'){
    const s=await st.config();return officeOpen(s)?{destination:{type:'number',number:s.transferNumber}}:{error:'The office is closed or transfer is unavailable. Offer a callback.'};
  }
  if(m.type==='end-of-call-report'){
    await command(st,env,'vapi',{callId:call,eventId:'ended:'+call,action:'end_call',input:{}});
    return {received:true};
  }
  demand(m.type==='tool-calls'&&Array.isArray(m.toolCallList)&&m.toolCallList.length>0&&m.toolCallList.length<=16,400,'Unsupported Vapi server event.');
  const results=[];
  for(const t of m.toolCallList){
    const id=safeId(t?.id,'tool identifier'),name=t?.function?.name;let result;
    try{
      const a=t.function.arguments||{};let input=a;
      if(typeof a==='string'){try{input=JSON.parse(a);}catch{throw new Problem(400,'Invalid tool arguments.');}}
      demand(name!=='end_call',400,'Unknown tool.');
      result={ok:true,...await command(st,env,'vapi',{callId:call,eventId:call+':'+id,action:name,input})};
    }catch(e){result={ok:false,error:e.status?e.message:'The service could not confirm this action.',retryable:!e.status||e.status>=500};}
    results.push({name,toolCallId:id,result:JSON.stringify(result)});
  }return {results};
}
export async function leasingApi(req,env,readBody,ctx){
  const path=new URL(req.url).pathname.slice('/api/leasing/'.length),post=req.method==='POST',get=req.method==='GET';
  if(['vapi','make'].includes(path)){
    demand(post,405,'Use POST.');
    const st=await machine(req,env,path==='vapi'?'VAPI_WEBHOOK_SECRET':'MAKE_COMMAND_SECRET');
    const b=await readBody(req,1024*1024);
    if(path==='vapi'){
      const r=await vapi(st,env,b.message);
      if(b.message?.type==='end-of-call-report')ctx?.waitUntil(deliverRental(st,env,3).catch(()=>{}));
      return reply(r);
    }
    demand(b.action!=='end_call',400,'Unknown command.');
    return reply({ok:true,...await command(st,env,'make',b)});
  }
  demand(get||post,405,'Use GET or POST.');
  const u=new URL(req.url);
  if(post){const origin=req.headers.get('origin');demand(!origin||origin===u.origin,403,'Origin is not allowed.');}
  const {db,auth}=services({...env,BETTER_AUTH_URL:u.origin===env.CUSTOM_ORIGIN?env.CUSTOM_ORIGIN:env.BETTER_AUTH_URL});
  const sess=await auth.api.getSession({headers:req.headers});demand(sess?.user,401,'Sign in to your landlord account.');
  const p=uuid(req.headers.get('x-sill-portfolio'));
  const [owner]=await rows(db,sql`select id,name from portfolios where id=${p} and manager_id=${sess.user.id}`);
  demand(owner,403,'Portfolio manager access is required.');
  const st=store(db,p);
  if(get&&path==='dashboard')return reply({...await snapshot(st),integrations:status(env,p),portfolio:owner});
  demand(post,405,'Use POST for changes.');const b=await readBody(req);
  if(path==='listing'){
    const detail=listing(b),id=b.id?uuid(b.id):crypto.randomUUID();
    const q=b.id?sql`update rental_listings set details=${JSON.stringify(detail)}::jsonb where id=${id} returning id`:
      sql`insert into rental_listings(portfolio_id,id,details) values(${p},${id},${JSON.stringify(detail)}::jsonb) returning id`;
    demand(await st.one(q),404,'Listing not found.');return reply({id});
  }
  if(path==='finance'){
    const id=uuid(b.listingId),plan=b.mode==='projected';
    demand(plan||b.mode==='actual',400,'Choose actuals or projections.');
    demand(await st.one(sql`select id from rental_listings where id=${id}`),404,'Listing not found.');
    const data=JSON.stringify(amounts(b.amounts,plan));
    if(plan){demand(['short','long'].includes(b.rentalType),400,'Choose a rental scenario.');
      await st.all(b.rentalType==='long'?sql`update rental_listings set long_plan=${data}::jsonb where id=${id}`:sql`update rental_listings set short_plan=${data}::jsonb where id=${id}`);
    }else{demand(validMonth(b.month),400,'Choose a valid month.');
      await st.all(sql`insert into rental_actuals(portfolio_id,listing_id,month,amounts) values(${p},${id},${b.month},${data}::jsonb)
        on conflict(portfolio_id,listing_id,month) do update set amounts=excluded.amounts`);}
    return reply({saved:true});
  }
  if(path==='settings'){
    const data=settings(b);await st.all(sql`insert into rental_settings(portfolio_id,settings) values(${p},${JSON.stringify(data)}::jsonb)
      on conflict(portfolio_id) do update set settings=excluded.settings`);return reply({saved:true});
  }
  if(path==='slot'){
    const id=uuid(b.listingId),start=instant(b.start),end=instant(b.end);
    demand(Date.parse(start)>Date.now()&&Date.parse(end)>Date.parse(start)&&Date.parse(end)-Date.parse(start)<=4*3600000,400,'Choose a future slot of up to four hours.');
    const [r]=await st.batch([sql`insert into rental_slots(portfolio_id,listing_id,starts_at,ends_at) select ${p},id,${start}::timestamptz,${end}::timestamptz from rental_listings where id=${id}
      and not exists(select 1 from rental_slots where starts_at<${end}::timestamptz and ends_at>${start}::timestamptz) returning id`],true);
    demand(r.length,409,'A slot overlaps or the listing was not found.');return reply(r[0]);
  }
  if(path==='booking'){
    demand(bound(env,p),503,'Connect this portfolio to its calendar.');
    return reply(b.action==='reconcile'?await reconcile(st,env,uuid(b.id)):await changeBooking(st,env,b));
  }
  if(path==='stage'){
    demand(['New','Follow up','Showing booked','Closed'].includes(b.stage),400,'Choose a follow-up status.');
    demand(await st.one(sql`update rental_leads set stage=${b.stage} where id=${uuid(b.id)} returning id`),404,'Lead not found.');return reply({saved:true});
  }
  if(path==='callback'){
    demand(await st.one(sql`update rental_callbacks set status='completed' where call_id=${safeId(b.callId,'call identifier')} returning call_id`),404,'Callback not found.');
    return reply({saved:true});
  }
  if(path==='retry'){
    demand(bound(env,p),503,'Connect this portfolio before retrying.');
    await st.all(sql`update rental_outbox set status='pending',attempts=0,due_at=now() where event_id=${field(b.eventId,460,'delivery identifier')} and status in ('failed','pending')`);
    return reply(await deliverRental(st,env,5));
  }
  throw new Problem(404,'Leasing route not found.');
}
