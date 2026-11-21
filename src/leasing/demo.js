import {defaultSettings} from './defaults.js';
const key='sill-leasing-demo-v1';
const asId=()=>crypto.randomUUID();
const listingIds=['91ab9457-fed9-4c64-b8fc-4879353d7313','7c7e2f27-b2f5-4dcb-ac74-c80b8a9e87d3','ba3dc16d-632f-4694-962c-c6064fe5a4f6'];
const common={utilities:9500,cleaning:5000,repairs:8800,insurance:12500,taxes:18700,hoa:7500,financing:75000,replacement:4500,repairReserve:2500};
const day=(days)=>{const d=new Date();d.setUTCDate(d.getUTCDate()+days);d.setUTCHours(16,0,0,0);return d;};
const date=d=>d.toISOString().slice(0,10);
export function monthLocal(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
export function seed(){
  const names=['Palmetto Court','Bayview Loft','Gulfside Studio'];
  const listings=names.map((name,i)=>({id:listingIds[i],name,location:i===2?'Gulfport':'St. Petersburg',address:['18 Sample Court','42 Example Lane','7 Sample Way'][i],
    bedrooms:[2,1,0][i],rent:[2150,1650,119][i],deposit:[1400,1100,250][i],rentalType:i===2?'short':'long',availability:i===1?'Unavailable':'Available',
    availableFrom:date(day(0)),amenities:['Courtyard, in-unit laundry, covered parking','Balcony, bike storage','Kitchenette, dedicated workspace'][i],
    requirements:'The property team reviews applications. Contact the office for the approved application form.',photo:i===0?'/assets/courtyard.webp':'',
    longPlan:{...common,potentialRent:[215000,165000,170000][i],occupancyBps:9500,feeBps:700},
    shortPlan:{...common,nightlyRate:[14500,10700,11900][i],occupancyBps:7200,feeBps:1150,cleaning:21000}}));
  const leads=[{id:'da5b0380-80d2-4ffb-acd7-a1464dbc11a2',name:'Alex Rivera',phone:'+12025550142',email:'alex@example.test',stage:'Showing booked',crmStatus:'Simulated',createdAt:day(-1).toISOString(),preferences:{budget:2300,bedrooms:2,location:'St. Petersburg',listingId:listingIds[0]}}];
  const slots=[1,2,3,4].map((d,i)=>({id:asId(),listingId:i===3?listingIds[2]:listingIds[0],start:day(d).toISOString(),end:new Date(+day(d)+1800000).toISOString(),holder:null}));
  const booking={id:asId(),leadId:leads[0].id,slotId:slots[0].id,listingId:listingIds[0],start:slots[0].start,end:slots[0].end,status:'confirmed',calendarEventId:'demo-calendar-001'};
  slots[0].holder=booking.id;
  const actuals=[];for(let i=0;i<3;i++){const dt=new Date();dt.setDate(1);dt.setMonth(dt.getMonth()-i);
    const month=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0');
    listings.forEach((l,j)=>actuals.push({listingId:l.id,month,amounts:{...common,collected:[215000,165000,258000][j]-i*3500,fees:[15050,11550,29450][j],cleaning:j===2?21000:5000}}));}
  return {portfolio:{name:'Bayline Rentals · Demo',id:'demo'},settings:{...defaultSettings,company:'Bayline Rentals'},listings,leads,slots,bookings:[booking],actuals,
    calls:[{id:'sample-call-001',leadId:leads[0].id,summary:'Alex asked about a two-bedroom rental and selected a showing at Palmetto Court.',nextAction:'Prepare the courtyard unit for the showing.',ended:true,createdAt:day(-1).toISOString()}],
    callbacks:[],deliveries:[],integrations:{scope:false,calendar:false,vapi:false,make:false,commands:false,hubspot:false}};
}
export function readDemo(){try{const saved=sessionStorage.getItem(key);if(saved)return JSON.parse(saved);}catch{}const state=seed();persist(state);return state;}
export function persist(d){try{sessionStorage.setItem(key,JSON.stringify(d));}catch{}}
function fail(message){throw Error(message);}
export function demoChange(d,path,b){
  if(path==='listing'){const i=d.listings.findIndex(l=>l.id===b.id);if(i>=0)Object.assign(d.listings[i],b);else d.listings.push({...b,id:asId(),longPlan:{},shortPlan:{}});}
  else if(path==='finance'){const l=d.listings.find(l=>l.id===b.listingId);if(b.mode==='projected')l[b.rentalType==='short'?'shortPlan':'longPlan']=b.amounts;
    else{d.actuals=d.actuals.filter(a=>a.listingId!==b.listingId||a.month!==b.month);d.actuals.push({listingId:b.listingId,month:b.month,amounts:b.amounts});}}
  else if(path==='settings')d.settings={...d.settings,...b};
  else if(path==='stage')d.leads.find(l=>l.id===b.id).stage=b.stage;
  else if(path==='callback')d.callbacks.find(c=>c.callId===b.callId).status='completed';
  else if(path==='slot'){
    if(Date.parse(b.start)<=Date.now()||Date.parse(b.end)<=Date.parse(b.start)||Date.parse(b.end)-Date.parse(b.start)>14400000)fail('Choose a future slot of up to four hours.');
    if(d.slots.some(s=>s.start<b.end&&s.end>b.start))fail('That time overlaps a showing slot.');
    d.slots.push({...b,id:asId(),holder:null});
  }else if(path==='booking'){
    const row=d.bookings.find(r=>r.id===b.id),s=d.slots.find(x=>x.id===row.slotId);
    if(b.action==='cancel'){row.status='cancelled';s.holder=null;}
    if(b.action==='move'){
      const next=d.slots.find(x=>x.id===b.slotId&&x.listingId===s.listingId&&!x.holder);if(!next)fail('The slot is unavailable.');
      next.holder=row.id;s.holder=null;Object.assign(row,{slotId:next.id,start:next.start,end:next.end});
    }
  }else if(path==='sample-call'){
    const slot=d.slots.find(s=>s.id===b.slotId&&!s.holder&&Date.parse(s.start)>Date.now()),l=d.listings.find(x=>x.id===slot?.listingId);
    if(!slot||l?.availability!=='Available')fail('This sample slot is unavailable.');
    const email='jordan@example.test',existing=d.leads.find(x=>x.email===email),lead=existing||{id:asId(),name:'Jordan Lee',phone:'+12025550156',email,createdAt:new Date().toISOString()};
    Object.assign(lead,{stage:'Showing booked',crmStatus:'Simulated',preferences:{budget:l.rentalType==='long'?l.rent:undefined,bedrooms:l.bedrooms,location:l.location,listingId:l.id,moveIn:l.availableFrom}});
    if(!existing)d.leads.unshift(lead);
    const id=asId();slot.holder=id;
    d.bookings.push({id,leadId:lead.id,slotId:slot.id,listingId:l.id,start:slot.start,end:slot.end,status:'confirmed',calendarEventId:'demo-'+id});
    d.calls.unshift({id:asId(),leadId:lead.id,summary:'Jordan asked about '+l.name+', confirmed their preferences and selected a showing.',nextAction:'Prepare the listing for the showing.',ended:true,createdAt:new Date().toISOString()});
    d.deliveries.unshift({eventId:'demo-'+id,kind:'crm.upsert',status:'simulated',attempts:1,receipt:'demo-contact-'+lead.id});
  }
  persist(d);
}
