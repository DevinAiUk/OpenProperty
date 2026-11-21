import {demand,field,uuid} from '../db.js';
import {cleanAmounts} from './finance.js';

import {defaultSettings,defaultMap} from './defaults.js';
export {defaultSettings} from './defaults.js';
export const optional=(v,max,label)=>v==null||v===''?'':field(v,max,label);
export function number(v,min,max,label,integer=false){
  demand(typeof v==='number' && Number.isFinite(v) && v>=min && v<=max && (!integer||Number.isInteger(v)),400,'Check '+label+'.');
  return v;
}
export function email(v){const s=optional(v,254,'email').toLowerCase();demand(!s||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),400,'Check the email address.');return s||null;}
export function phone(v){
  let s=optional(v,40,'phone number').replace(/[\s().-]/g,'');
  if(/^\d{10}$/.test(s))s='+1'+s;
  if(/^1\d{10}$/.test(s))s='+'+s;
  demand(!s||/^\+[1-9]\d{7,14}$/.test(s),400,'Use a phone number with a country code.');return s||null;
}
export function date(v){
  if(!v)return null;
  demand(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,400,'Check the date.');return v;
}
export function instant(v){
  demand(typeof v==='string'&&/T\d{2}:\d{2}.*(Z|[+-]\d{2}:\d{2})$/i.test(v)&&Number.isFinite(Date.parse(v)),400,'Use a time with a time zone.');
  return new Date(v).toISOString();
}
export function preferences(b){
  return Object.fromEntries(Object.entries({
    budget:b.budget==null?null:number(b.budget,0,1e7,'budget'),location:optional(b.location,120,'preferred location')||null,
    moveIn:date(b.moveIn),bedrooms:b.bedrooms==null?null:number(b.bedrooms,0,100,'bedroom count',true),
    listingId:b.listingId?uuid(b.listingId):null
  }).filter(([,v])=>v!=null));
}
export function listing(b){
  const availability=field(b.availability,15,'availability'),rentalType=field(b.rentalType,6,'rental type');
  demand(['Available','Unavailable'].includes(availability)&&['long','short'].includes(rentalType),400,'Check the availability and rental type.');
  const photo=optional(b.photo,500,'photo URL');
  if(photo){let u;try{u=new URL(photo);}catch{}demand(photo==='/assets/courtyard.webp'||(u?.protocol==='https:'&&!u.username&&!u.password),400,'Use an HTTPS photo URL.');}
  return {name:field(b.name,110,'listing name'),location:field(b.location,150,'location'),address:optional(b.address,180,'showing address'),
    availability,rentalType,availableFrom:date(b.availableFrom),rent:number(b.rent,0,1e7,'monthly or nightly rent'),deposit:number(b.deposit,0,1e7,'deposit'),
    bedrooms:number(b.bedrooms,0,100,'bedroom count',true),amenities:optional(b.amenities,900,'amenities'),requirements:optional(b.requirements,1200,'approved requirements'),photo};
}
export function matches(listing,query){
  const rentCeiling=query.maxRent;
  return listing.availability==='Available' && (!query.location||listing.location.toLowerCase().includes(query.location.toLowerCase()))
    && (rentCeiling==null||(listing.rentalType==='long'&&listing.rent<=rentCeiling))
    && (query.bedrooms==null||listing.bedrooms===query.bedrooms)
    && (!query.moveIn||(listing.availableFrom&&listing.availableFrom<=query.moveIn));
}
export function amounts(b,plan=false){try{return cleanAmounts(b,plan);}catch(e){demand(false,400,e.message);}}
export function settings(b){
  const s={...defaultSettings,...b};
  for(const k of ['company','voice','language','tone','fallback'])s[k]=field(s[k],k==='fallback'?280:120,k);
  for(const k of ['greeting','disclosure'])s[k]=optional(s[k],850,k);
  demand(['en','es','fr','en-US','es-US','fr-CA'].includes(s.language),400,'Choose a supported speech language.');
  s.pace=number(s.pace,0.8,1.2,'voice speed');
  s.transferNumber=phone(s.transferNumber)||'';s.notifyTo=email(s.notifyTo)||'';
  for(const k of ['recording','transcription','transferEnabled','notifyEnabled']) demand(typeof s[k]==='boolean',400,'Check '+k+'.');
  demand(!s.transferEnabled||s.transferNumber,400,'Add a transfer number first.');
  demand(!s.notifyEnabled||s.notifyTo,400,'Add a notification email first.');
  demand(!s.recording&&!s.transcription||s.disclosure.trim().length>0,400,'Add the approved consent disclosure.');
  demand(['make','hubspot'].includes(s.crmMode),400,'Choose a CRM route.');
  demand(Array.isArray(s.officeDays)&&s.officeDays.every(d=>Number.isInteger(d)&&d>=0&&d<=6),400,'Check office days.');
  demand([s.officeStart,s.officeEnd].every(v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v))&&s.officeEnd>s.officeStart,400,'Check office hours.');
  try{new Intl.DateTimeFormat('en',{timeZone:s.timezone});}catch{demand(false,400,'Choose an IANA time zone.');}
  const map={}; for(const k of Object.keys(defaultMap)){const v=s.crmMap?.[k]??defaultMap[k];demand(typeof v==='string'&&(!v||/^[a-z][a-z0-9_]{0,79}$/.test(v)),400,'Check the CRM mapping.');map[k]=v;}
  demand(map.leadKey&&!['email','phone','firstname','lastname'].includes(map.leadKey),400,'Choose a unique SiLL ID property in your CRM.');
  const values=Object.values(map).filter(Boolean);demand(new Set(values).size===values.length,400,'Map each CRM property once.');
  return Object.fromEntries(Object.keys(defaultSettings).map(k=>[k,k==='crmMap'?map:s[k]]));
}
export function officeOpen(s,now=new Date()){
  if(!s.transferEnabled||!s.transferNumber)return false;
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:s.timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(i=>[i.type,i.value]));
  const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday),time=parts.hour+':'+parts.minute;
  return s.officeDays.includes(day)&&time>=s.officeStart&&time<s.officeEnd;
}
