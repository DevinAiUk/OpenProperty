import assert from 'node:assert/strict';
export async function verifyLeasing({env,engine,account,request,setProvider}){
  const manager=await account('leasing-owner@example.test'),other=await account('leasing-neighbor@example.test');
  const portfolio=(await request('/api/portfolios',{cookie:manager,data:{name:'Leasing Alpha'}})).body.id;
  const second=(await request('/api/portfolios',{cookie:other,data:{name:'Leasing Beta'}})).body.id;
  const act=(path,data)=>request('/api/leasing/'+path,{cookie:manager,portfolio,data});
  const dash=async()=>{const r=await act('dashboard');assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
  assert.equal((await request('/api/leasing/dashboard',{portfolio})).status,401);
  assert.equal((await request('/api/leasing/dashboard',{portfolio,cookie:other})).status,403);
  assert.equal((await request('/api/leasing/dashboard',{portfolio:second,cookie:manager})).status,403);
  const empty=await dash();assert.deepEqual(empty.listings,[]);assert.equal(empty.integrations.vapi,false);
  const listing={name:'Sample Court',location:'St. Petersburg',address:'18 Sample Court',availability:'Available',rent:2100,deposit:1400,bedrooms:2,rentalType:'long',amenities:'Courtyard',requirements:'Contact the property team.'};
  const l=await act('listing',listing),u=await act('listing',{...listing,name:'Unavailable property',availability:'Unavailable'});
  assert.equal(l.status,200,JSON.stringify(l.body));const listingId=l.body.id;
  const future=(n)=>new Date(Date.now()+n*86400000).toISOString();
  async function slot(n){
    const start=future(n),end=new Date(Date.parse(start)+1800000).toISOString();
    const r=await act('slot',{listingId,start,end});assert.equal(r.status,200,JSON.stringify(r.body));return {id:r.body.id,start,end};
  }
  const first=await slot(3),next=await slot(4),busySlot=await slot(5),lostAck=await slot(6);
  assert.equal((await act('slot',{listingId,start:first.start,end:first.end})).status,409);
  assert.equal((await act('finance',{listingId,month:'2028-02',mode:'actual',amounts:{collected:200000,fees:6500}})).status,200);
  assert.equal((await act('finance',{listingId,mode:'projected',rentalType:'short',amounts:{nightlyRate:15000,occupancyBps:6500}})).status,200);
  Object.assign(env,{SILL_LEASING_PORTFOLIO_ID:portfolio,VAPI_WEBHOOK_SECRET:'voice-fixture',MAKE_COMMAND_SECRET:'make-command-fixture',
    GOOGLE_CALENDAR_ID:'calendar@example.test',GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'fixture',GOOGLE_REFRESH_TOKEN:'fixture',
    MAKE_WEBHOOK_URL:'https://make.example.test/deliver',MAKE_WEBHOOK_KEY:'fixture'});
  const events=new Map(),dispatched=[];let drop=false,badAck=false;let extraBusy=[];
  const good=(v,status=200)=>Response.json(v,{status});
  setProvider(async(url,opt={})=>{
    if(url==='https://oauth2.googleapis.com/token')return good({access_token:'fixture-response'});
    if(url==='https://www.googleapis.com/calendar/v3/freeBusy'){
      const occupied=[...events.values()].filter(v=>v.status==='confirmed').map(e=>({start:e.start.dateTime,end:e.end.dateTime}));
      return good({calendars:{[env.GOOGLE_CALENDAR_ID]:{busy:[...occupied,...extraBusy]}}});
    }
    if(url.startsWith('https://www.googleapis.com/calendar/v3/calendars/')){
      const method=opt.method||'GET',key=new URL(url).pathname.split('/').at(-1);
      if(method==='GET')return events.has(key)?good(events.get(key)):good({},404);
      if(method==='DELETE'){events.delete(key);return new Response(null,{status:204});}
      const doc=JSON.parse(opt.body),id=doc.id||key;
      if(method==='POST'&&events.has(id))return good({},409);
      const evt={...doc,id,etag:'etag',status:'confirmed'};events.set(id,evt);
      if(drop){drop=false;throw Error('Simulated response lost after commit');}return good(evt);
    }
    if(url==='https://make.example.test/deliver'){
      const b=JSON.parse(opt.body);assert.equal(opt.headers['x-make-apikey'],'fixture');dispatched.push(b);
      return good(badAck?{accepted:true}:{status:'confirmed',eventId:b.eventId,recordId:b.kind==='crm.upsert'?'fixture-contact-'+b.leadId:'fixture-message-'+b.eventId});
    }
    throw Error('Unexpected provider '+url);
  });
  const make=(action,input={},callId='call-A',eventId=crypto.randomUUID())=>request('/api/leasing/make',{bearer:env.MAKE_COMMAND_SECRET,data:{callId,eventId,action,input}});
  const voice=(m,secret=env.VAPI_WEBHOOK_SECRET)=>request('/api/leasing/vapi',{bearer:secret,data:{message:m}});
  const call=(name,args,callId='call-A',id=crypto.randomUUID())=>voice({type:'tool-calls',call:{id:callId},toolCallList:[{id,function:{name,arguments:JSON.stringify(args)}}]});
  const val=async(p)=>{const r=await p;assert.equal(r.status,200,JSON.stringify(r.body));return JSON.parse(r.body.results[0].result);};
  const lookup=await val(call('lookup_listings',{location:'St. Petersburg',bedrooms:2,maxRent:2200}));
  assert.equal(lookup.listings.length,1);assert.equal(lookup.listings[0].rent,2100);assert.equal(lookup.listings[0].requirements,listing.requirements);assert.equal(lookup.listings[0].longPlan,undefined);
  assert.equal((await make('available_slots',{listingId:u.body.id})).body.slots.length,0);
  assert.equal((await voice({type:'end-of-call-report',call:{id:'call-A'}},'bad')).status,401);
  assert.equal((await make('book_showing',{slotId:first.id,confirmed:true})).status,422);
  assert.equal((await make('capture_inquiry',{name:'Fixture',confirmed:true})).status,422);
  const inquiry={name:'Jordan Example',phone:'+12025550156',email:'jordan@example.test',confirmed:true,location:listing.location,budget:2200,bedrooms:2,moveIn:'2030-03-01',listingId};
  const key=crypto.randomUUID();
  assert.equal((await val(call('capture_inquiry',inquiry,'call-A',key))).saved,true);
  assert.equal((await val(call('capture_inquiry',inquiry,'call-A',key))).saved,true);
  assert.equal((await val(call('capture_inquiry',{...inquiry,name:'Different'},'call-A',key))).ok,false);
  assert.equal((await make('capture_inquiry',inquiry,'call-duplicate')).body.saved,true);
  assert.equal((await dash()).leads.length,1);
  assert.equal((await val(call('available_slots',{listingId}))).slots.length,4);
  assert.equal((await make('book_showing',{slotId:first.id,confirmed:false})).status,400);
  const got=await val(call('book_showing',{slotId:first.id,confirmed:true}));
  assert.equal(got.status,'confirmed',JSON.stringify(got));assert.ok(got.calendarEventId);assert.equal(events.size,1);
  assert.equal((await val(call('book_showing',{slotId:first.id,confirmed:true}))).calendarEventId,got.calendarEventId);
  assert.equal((await make('book_showing',{slotId:first.id,confirmed:true},'call-duplicate')).status,409);
  extraBusy=[{start:busySlot.start,end:busySlot.end}];
  assert.equal((await make('book_showing',{slotId:busySlot.id,confirmed:true})).status,409);
  assert.ok(!(await val(call('available_slots',{listingId}))).slots.some(x=>x.id===busySlot.id));
  const summary={summary:'Jordan selected a two-bedroom showing.',nextAction:'Prepare the property.'};
  assert.equal((await val(call('summarize_call',summary))).saved,true);
  const end={type:'end-of-call-report',call:{id:'call-A'},artifact:{transcript:'NEVER_PERSIST_RAW_AUDIO_OR_TRANSCRIPT'}};
  assert.equal((await voice(end)).body.received,true);assert.equal((await voice(end)).body.received,true);
  const callback=await val(call('request_callback',{reason:'Ask about the rental agreement.'}));assert.equal(callback.status,'requested');
  assert.equal((await make('request_callback',{reason:'Human requested.'},'unknown')).body.status,'needs_contact');
  const transfer=await voice({type:'transfer-destination-request',call:{id:'call-A'}});assert.ok(transfer.body.error);
  let dashboard=await dash();const b=dashboard.bookings.find(x=>x.calendarEventId===got.calendarEventId);
  assert.equal((await act('booking',{action:'move',id:b.id,slotId:next.id,confirmed:true})).body.status,'confirmed');
  assert.equal((await act('booking',{action:'cancel',id:b.id,confirmed:true})).body.status,'cancelled');assert.equal(events.size,0);
  drop=true;const uncertain=await val(call('book_showing',{slotId:lostAck.id,confirmed:true}));assert.equal(uncertain.ok,false);
  dashboard=await dash();const awaiting=dashboard.bookings.find(x=>x.status==='pending');assert.ok(awaiting);assert.equal(events.size,1);
  const recovery=await act('booking',{action:'reconcile',id:awaiting.id});assert.equal(recovery.body.status,'confirmed');assert.equal(events.size,1);
  assert.ok(!JSON.stringify(dashboard).includes('NEVER_PERSIST_RAW'));assert.equal(dashboard.calls.find(c=>c.id==='call-A').summary,summary.summary);
  assert.equal(dashboard.leads[0].crmStatus,'Pending');
  let job=dashboard.deliveries.find(x=>x.kind==='crm.upsert');
  badAck=true;await act('retry',{eventId:job.eventId});dashboard=await dash();
  assert.ok(dashboard.deliveries.some(j=>j.failure));assert.equal(dashboard.leads[0].crmStatus,'Pending');
  badAck=false;await act('retry',{eventId:job.eventId});dashboard=await dash();assert.equal(dashboard.leads[0].crmStatus,'Synced');
  assert.ok(dashboard.deliveries.some(j=>j.receipt?.startsWith('fixture-contact-')));assert.ok(dispatched.some(p=>p.contact.email===inquiry.email&&p.preferences.budget===2200));
  assert.equal(dashboard.actuals[0].amounts.collected,200000);
  assert.equal((await request('/api/leasing/dashboard',{portfolio:second,cookie:other})).body.leads.length,0);
  assert.equal((await engine.query('select id from rental_leads')).rows.length,0);
}

