import {Problem,demand} from '../db.js';
const google='https://www.googleapis.com/calendar/v3';
export const calendarReady=e=>Boolean(e.GOOGLE_CALENDAR_ID&&e.GOOGLE_CLIENT_ID&&e.GOOGLE_CLIENT_SECRET&&e.GOOGLE_REFRESH_TOKEN);
const timeout=()=>AbortSignal.timeout(7000);
async function send(url,opts){
  try{return await fetch(url,{...opts,signal:timeout(),redirect:'error'});}
  catch{throw new Problem(503,'Provider did not confirm. Retry or review the pending record.');}
}
async function read(res){try{return await res.json();}catch{return {};}}
export async function calendar(env){
  demand(calendarReady(env),503,'Google Calendar needs a connection.');
  const oauth=await send('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({
    grant_type:'refresh_token',client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN
  })});
  const auth=await read(oauth);demand(oauth.ok&&typeof auth.access_token==='string',503,'Google Calendar authorization failed.');
  const id=env.GOOGLE_CALENDAR_ID,base=google+'/calendars/'+encodeURIComponent(id)+'/events';
  const g=(url,method='GET',body,etag)=>send(url,{method,headers:{authorization:'Bearer '+auth.access_token,'content-type':'application/json',...(etag?{'if-match':etag}:{})},body:body?JSON.stringify(body):undefined});
  async function busy(start,end){
    const res=await g(google+'/freeBusy','POST',{timeMin:start,timeMax:end,items:[{id}]});
    const entry=(await read(res)).calendars?.[id];
    demand(res.ok&&entry&&!entry.errors?.length&&Array.isArray(entry.busy)&&entry.busy.every(r=>Number.isFinite(Date.parse(r.start))&&Number.isFinite(Date.parse(r.end))),503,'The calendar could not verify availability.');return entry.busy;
  }
  async function event(key){
    const r=await g(base+'/'+key);
    if(r.status===404||r.status===410)return null;
    demand(r.ok,503,'The calendar could not verify the event.');return read(r);
  }
  function receipt(v,key,booking,slot){
    return v?.id===key && v.status==='confirmed'&&v.extendedProperties?.private?.sillBooking===booking
      &&Date.parse(v.start?.dateTime)===Date.parse(slot.start)&&Date.parse(v.end?.dateTime)===Date.parse(slot.end);
  }
  async function free(slot){const blocks=await busy(slot.start,slot.end);return !blocks.some(i=>overlap(i,slot));}
  return {busy,async place(booking,slot,name,moving=false){
    const key='sill'+booking.replaceAll('-',''),existing=await event(key);
    if(receipt(existing,key,booking,slot))return key;
    demand(!existing||existing.extendedProperties?.private?.sillBooking===booking,503,'Calendar event needs review.');
    if(moving)demand(existing?.status==='confirmed'&&existing.etag,503,'The original calendar event needs review.');
    else demand(!existing,503,'The reserved calendar event needs review.');
    demand(await free(slot),409,'This time is already occupied on the calendar.');
    const record={summary:'SiLL showing · '+name,start:{dateTime:slot.start},end:{dateTime:slot.end},extendedProperties:{private:{sillBooking:booking}}};
    const r=moving?await g(base+'/'+key+'?sendUpdates=none','PATCH',record,existing.etag):await g(base+'?sendUpdates=none','POST',{...record,id:key});
    const data=await read(r);
    if(r.ok&&receipt(data,key,booking,slot))return key;
    if(r.status===409||r.status===412){const check=await event(key);if(receipt(check,key,booking,slot))return key;}
    throw new Problem(503,'Calendar confirmation is pending. The time is held for reconciliation.');
  },async cancel(booking,key){
    demand(key==='sill'+booking.replaceAll('-',''),503,'Calendar reference needs review.');
    const v=await event(key);
    if(!v||v.status==='cancelled')return true;
    demand(v.extendedProperties?.private?.sillBooking===booking&&v.etag,503,'The calendar event needs review.');
    const r=await g(base+'/'+key+'?sendUpdates=none','DELETE',undefined,v.etag);
    demand(r.status===204||r.status===410,503,'Calendar cancellation is pending.');return true;
  }};
}
export const overlap=(a,b)=>Date.parse(a.start)<Date.parse(b.end)&&Date.parse(a.end)>Date.parse(b.start);
export async function pushDelivery(env,settings,payload){
  if(payload.kind==='crm.upsert'&&settings.crmMode==='hubspot'){
    demand(env.HUBSPOT_TOKEN,503,'HubSpot needs a connection.');
    const p=payload.preferences||{},map=settings.crmMap,props={[map.leadKey]:payload.leadId};
    const source={...p,...payload.contact,summary:payload.summary,nextAction:payload.nextAction};
    for(const [key,v] of Object.entries(map)) if(key!=='leadKey'&&v&&source[key]!=null&&source[key]!=='')props[v]=String(source[key]);
    const parts=payload.contact.name.trim().split(/\s+/);props.firstname=parts.shift();if(parts.length)props.lastname=parts.join(' ');
    const r=await send('https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert',{method:'POST',
      headers:{authorization:'Bearer '+env.HUBSPOT_TOKEN,'content-type':'application/json'},body:JSON.stringify({inputs:[{
        idProperty:map.leadKey,id:payload.leadId,properties:props}]})});
    const v=await read(r),record=v.results?.[0];
    demand(r.ok&&v.status==='COMPLETE'&&!v.numErrors&&!v.errors?.length&&/^\d+$/.test(String(record?.id))&&record.properties?.[map.leadKey]===payload.leadId,503,'HubSpot did not return a matching contact receipt.');
    return String(record.id);
  }
  demand(env.MAKE_WEBHOOK_URL&&env.MAKE_WEBHOOK_KEY,503,'Make needs a webhook connection.');
  let u;try{u=new URL(env.MAKE_WEBHOOK_URL);}catch{}
  demand(u?.protocol==='https:'&&!u.username&&!u.password,503,'Check the Make webhook configuration.');
  const r=await send(u.href,{method:'POST',headers:{'content-type':'application/json','x-make-apikey':env.MAKE_WEBHOOK_KEY},body:JSON.stringify(payload)});
  const data=await read(r);
  demand(r.ok&&data.status==='confirmed'&&data.eventId===payload.eventId&&typeof data.recordId==='string'&&data.recordId.trim().length>0&&data.recordId.length<=240,503,'Make did not return a matching provider receipt.');
  return data.recordId;
}
