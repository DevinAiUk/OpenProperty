import {esc,btn,choice,field,select,area,check,empty,row,when,prop,form,ttl} from './ui.js';
import {overview,listings,leads,calendarView,financials,settingsView} from './views.js';
import {readDemo,demoChange,monthLocal} from './demo.js';
import {costs,reserves,cleanAmounts,validMonth,money} from './finance.js';
import {defaultMap} from './defaults.js';

const $=s=>document.querySelector(s),demo=document.body.dataset.mode==='demo';
const views={overview,listings,leads,calendar:calendarView,financials,settings:settingsView};
const hints={overview:'Income, inquiries, and the showings ahead.',listings:'Listing facts approved for callers and showings.',leads:'Contact details, preferences, and the next conversation.',calendar:'Showing windows and calendar-confirmed appointments.',financials:'Rental income, expenses, and the cash available after reserves.',settings:'Voice, calendars, CRM delivery, and landlord notifications.'};
let d,portfolios=[],selected='',saveHandler,version=0;
const filters={month:monthLocal(),mode:'actual',year:false,listing:'',strategy:'configured'};
const dialog=$('#dialog'),content=$('#content');
function note(message){const el=$('#message');el.hidden=!message;el.textContent=message;}
function message(error){return error instanceof Error?error.message:'The operation could not be completed.';}
async function api(path,data){
 const res=await fetch(path,{method:data?'POST':'GET',credentials:'same-origin',headers:{...(data?{'content-type':'application/json'}:{}),...(selected?{'x-sill-portfolio':selected}:{})},body:data?JSON.stringify(data):undefined});
 const v=await res.json();if(!res.ok){const err=Error(v.error||'Request failed.');err.status=res.status;throw err;}return v;
}
async function reload(){const k=++version;const data=demo?readDemo():await api('/api/leasing/dashboard');if(k!==version)return;d=data;render();}
async function mutate(path,b){
 if(demo)demoChange(d,path,b);else await api('/api/leasing/'+path,b);
 await reload();
}
function view(){const v=location.hash.slice(1);return Object.hasOwn(views,v)?v:'overview';}
function render(){
 const v=view();$('#portfolio-name').textContent=d.portfolio.name;$('#title').textContent=ttl(v);$('#subtitle').textContent=hints[v];
 for(const a of document.querySelectorAll('nav a')){if(a.hash==='#'+v)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
 $('#top-actions').innerHTML=(demo?'<span class="chip muted">Demo data</span>':portfolios.length>1?'<label>Portfolio <select id="switch">'+choice(portfolios.map(p=>[p.id,p.name]),selected)+'</select></label>':'')+(demo?btn('Try a sample call','walk','',''):'');
 if($('#switch'))$('#switch').onchange=async e=>{selected=e.target.value;d=null;content.textContent='Loading portfolio…';filters.listing='';try{await reload();}catch(err){content.textContent=message(err);}};
 content.innerHTML=v==='overview'?overview(d,filters,demo):v==='financials'?financials(d,filters):v==='calendar'?calendarView(d,demo):v==='settings'?settingsView(d,demo):views[v](d);
}
function modal(title,html,submit){
 $('#dialog-title').textContent=title;$('#dialog-error').textContent='';$('#dialog-body').innerHTML=html;saveHandler=submit;
 if(!dialog.open)dialog.showModal();
}
function close(){dialog.close();saveHandler=null;}
$('#close-dialog').onclick=close;
dialog.addEventListener('submit',async e=>{
 if(e.target.id!=='edit-form')return;e.preventDefault();const button=e.submitter;if(button)button.disabled=true;
 try{const b=Object.fromEntries(new FormData(e.target));await saveHandler(b,e.target);}
 catch(err){$('#dialog-error').textContent=message(err);}
 finally{if(button)button.disabled=false;}
});
function edit(title,path,html,label,map){modal(title,form(html,label),async(b,f)=>{await mutate(path,map(b,f));close();note('Saved.');});}
function listingEditor(id){
 const l=d.listings.find(x=>x.id===id)||{};
 edit(id?'Edit listing':'Add listing','listing',field('Listing name','name',l.name,'text','required maxlength="110"')+
 field('Location','location',l.location,'text','required')+field('Showing address','address',l.address)+
 select('Rental type','rentalType',[['long','Long-term · monthly rent'],['short','Short-term · nightly rent']],l.rentalType||'long')+
 field('Rent in USD','rent',l.rent,'number','required min="0" step="0.01"')+field('Deposit in USD','deposit',l.deposit??0,'number','required min="0" step="0.01"')+
 field('Bedrooms (0 for studio)','bedrooms',l.bedrooms??1,'number','min="0" max="100" required')+select('Availability','availability',['Unavailable','Available'],l.availability||'Unavailable')+
 field('Available from','availableFrom',l.availableFrom,'date')+field('Approved photo URL','photo',l.photo,'text','maxlength="500"')+
 area('Approved amenities','amenities',l.amenities)+area('Approved rental requirements','requirements',l.requirements),'Save listing',b=>{
  if(b.photo&&!/^https:\/\//i.test(b.photo)&&b.photo!=='/assets/courtyard.webp')throw Error('Use an HTTPS photo URL.');
  return {...b,...(id?{id}:{}),rent:+b.rent,deposit:+b.deposit,bedrooms:+b.bedrooms};
 });
}
function financeEditor(id=filters.listing||d.listings[0]?.id,mode=filters.mode,month=filters.month,strategy=filters.strategy){
 if(!id) return modal('Financial inputs',empty('Add a listing before entering financials.'),null);
 const l=d.listings.find(x=>x.id===id),type=strategy==='configured'?l.rentalType:strategy,plan=mode==='projected';
 const data=plan?(type==='long'?l.longPlan:l.shortPlan):d.actuals.find(a=>a.listingId===id&&a.month===month)?.amounts;
 const a=cleanAmounts(data||{},plan),usd=(label,k)=>field(label+' ($)',k,(a[k]||0)/100,'number','required min="0" max="20000000" step="0.01"');
 let fields=select('Property','listingId',d.listings.map(x=>[x.id,x.name]),id)+select('Inputs','mode',[['actual','Actual results'],['projected','Projected assumptions']],mode);
 fields+=plan?select('Rental scenario','rentalType',[['long','Long-term'],['short','Short-term']],type):field('Month','month',month,'month','required min="2000-01" max="2200-12"');
 fields+=plan?(type==='long'?usd('Potential monthly rent','potentialRent'):usd('Nightly rate','nightlyRate'))+field('Occupancy (%)','occupancyBps',a.occupancyBps/100,'number','required min="0" max="100" step="0.01"')+
 field('Vacancy (%)','vacancy',100-a.occupancyBps/100,'number','required min="0" max="100" step="0.01"')+field('Fee on occupied rent (%)','feeBps',a.feeBps/100,'number','required min="0" max="100" step="0.01"'):usd('Rent actually collected','collected');
 for(const [k,label] of Object.entries(costs))if(!plan||k!=='fees')fields+=usd(label,k);
 for(const [k,label] of Object.entries(reserves))fields+=usd((plan?'Planned · ':'Transferred · ')+label,k);
 fields+=check('Property taxes included in financing','taxesEscrowed',a.taxesEscrowed)+check('Insurance included in financing','insuranceEscrowed',a.insuranceEscrowed)+
 '<p class="field-wide">Escrowed taxes or insurance are excluded from their separate lines. Enter repairs paid from operating cash. Purchases paid from an already deducted reserve do not use operating cash again.</p>';
 modal('Edit financial inputs',form(fields,'Save financial inputs'),async(b,f)=>{
   const amounts={...a};for(const k of Object.keys(amounts)){if(k.endsWith('Escrowed'))amounts[k]=f.elements[k].checked;else if(k in b)amounts[k]=Math.round(Number(b[k])*100);}
   await mutate('finance',{listingId:id,month,mode,rentalType:type,amounts:cleanAmounts(amounts,plan)});close();note('Financial inputs saved.');
 });
 const f=$('#edit-form'),redraw=()=>financeEditor(f.elements.listingId.value,f.elements.mode.value,f.elements.month?.value||month,f.elements.rentalType?.value||'configured');
 for(const k of ['listingId','mode','rentalType','month'])if(f.elements[k])f.elements[k].onchange=redraw;
 if(plan){f.elements.occupancyBps.oninput=()=>{f.elements.vacancy.value=Number((100-Number(f.elements.occupancyBps.value)).toFixed(2));};
 f.elements.vacancy.oninput=()=>{f.elements.occupancyBps.value=Number((100-Number(f.elements.vacancy.value)).toFixed(2));};}
}
function voiceEditor(){
 const s=d.settings;edit('Voice and handoff','settings',field('Company name','company',s.company,'text','required')+select('Language','language',[['en','English'],['es','Spanish'],['fr','French']],s.language)+
 select('Voice','voice',['Elliot','Clara','Emma','Kai'],s.voice)+field('Speaking speed','pace',s.pace,'number','min=".8" max="1.2" step=".01" required')+
 area('Greeting','greeting',s.greeting)+field('Conversational tone','tone',s.tone,'text','required')+area('Integration failure response','fallback',s.fallback)+
 field('Time zone','timezone',s.timezone,'text','required')+field('Transfer number with country code','transferNumber',s.transferNumber,'tel')+check('Enable human transfers during office hours','transferEnabled',s.transferEnabled)+
 field('Office opens','officeStart',s.officeStart,'time','required')+field('Office closes','officeEnd',s.officeEnd,'time','required')+
 '<fieldset class="field-wide"><legend>Office days</legend>'+['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((v,i)=>check(v,'day'+i,s.officeDays.includes(i))).join('')+'</fieldset>'+
 check('Request consent-gated recording','recording',s.recording)+check('Request consent-gated transcript retention','transcription',s.transcription)+area('Approved disclosure','disclosure',s.disclosure)+
 '<p class="field-wide">Export saved settings to update the Vapi assistant. Retention requires the supported consent feature and an approved disclosure.</p>','Save voice settings',(b,f)=>{
   const v={...s,...b,pace:+b.pace,officeDays:Array.from({length:7},(_,i)=>i).filter(i=>f.elements['day'+i].checked)};
   for(const k of ['recording','transcription','transferEnabled'])v[k]=f.elements[k].checked;
   if((v.recording||v.transcription)&&!v.disclosure.trim())throw Error('Enter the approved consent disclosure.');
   if(v.transferEnabled&&!v.transferNumber)throw Error('Enter the human transfer number.');return v;
 });
}
function mappingEditor(){
 const s=d.settings;edit('CRM mapping and notifications','settings',select('CRM delivery route','crmMode',[['make','Make to CRM'],['hubspot','HubSpot direct']],s.crmMode)+
 check('Notify landlord via Make','notifyEnabled',s.notifyEnabled)+field('Notification recipient','notifyTo',s.notifyTo,'email')+
 '<p class="field-wide">Map each SiLL field to the internal CRM property name. The lead ID property must have unique values enabled.</p>'+
 Object.keys(defaultMap).map(k=>field(k==='leadKey'?'Unique lead ID property':ttl(k)+' property','map_'+k,s.crmMap[k])).join('')+
 '<p class="field-wide">Server-side credentials connect the calendar and delivery webhook. Credentials are never entered into this form.</p>','Save mapping',(b,f)=>{
   if(f.elements.notifyEnabled.checked&&!b.notifyTo)throw Error('Enter a notification recipient.');
   return {...s,crmMode:b.crmMode,notifyTo:b.notifyTo,notifyEnabled:f.elements.notifyEnabled.checked,crmMap:Object.fromEntries(Object.keys(defaultMap).map(k=>[k,b['map_'+k]]))};
 });
}
function walk(step=0,property='',slotId=''){
 const available=d.listings.filter(l=>l.availability==='Available'),l=d.listings.find(x=>x.id===property)||available[0],slots=d.slots.filter(s=>!s.holder&&s.listingId===l?.id&&Date.parse(s.start)>Date.now()),slot=slots.find(s=>s.id===slotId)||slots[0];
 if(!l)return modal('Sample call',empty('Add an available demo listing to run the sample.'),null);
 const context='<p class="sub">Simulated call · Jordan Lee · sample contact only</p>';
 if(step===0)modal('Ask about a property',context+form(select('Property of interest','property',available.map(x=>[x.id,x.name]),l.id),'Look up listing'),b=>walk(1,b.property));
 if(step===1)modal('Confirm the caller’s preferences',context+row(l.name,l.location+' · '+l.bedrooms+' bedrooms · '+money(Math.round(l.rent*100))+(l.rentalType==='long'?' monthly':' nightly'))+
 row('Approved details',l.amenities||'No amenities listed.')+row('Contact readback','Jordan Lee · jordan@example.test · +1 202 555 0156')+
 form(select('Choose a showing window','slot',slots.map(s=>[s.id,when(s.start,d.settings.timezone)]),slot?.id),slots.length?'Review this time':'Return to calendar'),b=>{if(!b.slot){close();location.hash='calendar';}else walk(2,l.id,b.slot);});
 if(step===2)modal('Confirm the showing',context+row(l.name,when(slot.start,d.settings.timezone))+empty('Jordan has agreed to save the contact details and book this time.')+
 form('','Confirm sample booking'),async()=>{await mutate('sample-call',{slotId:slot.id});close();location.hash='leads';note('Sample showing confirmed. Jordan’s lead, summary, and simulated CRM receipt are saved in this tab.');});
}
async function action(a,id){
 if(a.startsWith('open-')){location.hash=a.slice(5);return;}
 if(a==='edit-listing')return listingEditor(id);
 if(a==='edit-finance')return financeEditor();
 if(a==='edit-settings')return voiceEditor();
 if(a==='edit-mapping')return mappingEditor();
 if(a==='export-voice'){
   const keys=['company','greeting','language','voice','pace','tone','fallback','transferEnabled','recording','transcription','disclosure'];
   const href=URL.createObjectURL(new Blob([JSON.stringify(Object.fromEntries(keys.map(k=>[k,d.settings[k]])),null,2)],{type:'application/json'}));
   const link=document.createElement('a');link.href=href;link.download='sill-voice-settings.json';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);return;
 }
 if(a==='walk'&&demo)return walk();
 if(a==='stage'){const l=d.leads.find(x=>x.id===id);return edit('Follow-up status','stage',select('Status','stage',['New','Follow up','Showing booked','Closed'],l.stage),'Save status',b=>({...b,id}));}
 if(a==='callback'){await mutate('callback',{callId:id});return note('Callback marked complete.');}
 if(a==='add-slot'){
   if(!d.listings.length)return modal('Add showing window',empty('Create a listing first.'),null);
   const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
   return edit('Add showing window','slot',select('Listing','listingId',d.listings.map(l=>[l.id,l.name]),d.listings[0].id)+field('Start · '+tz,'start','','datetime-local','required')+
    field('End · '+tz,'end','','datetime-local','required'),'Save window',b=>({...b,start:new Date(b.start).toISOString(),end:new Date(b.end).toISOString()}));
 }
 if(a==='cancel'||a==='reschedule'){
   const booking=d.bookings.find(x=>x.id===id),slots=d.slots.filter(s=>s.listingId===booking.listingId&&!s.holder&&Date.parse(s.start)>Date.now());
   if(a==='reschedule'&&!slots.length)return modal('Reschedule showing',empty('Add another future showing window for this listing.'),null);
   return edit(a==='cancel'?'Cancel showing':'Reschedule showing','booking',row(prop(d,booking.listingId),when(booking.start,d.settings.timezone))+
    (a==='reschedule'?select('Replacement time','slotId',slots.map(s=>[s.id,when(s.start,d.settings.timezone)]),slots[0]?.id):''),a==='cancel'?'Confirm cancellation':'Confirm reschedule',b=>({...b,id,confirmed:true,action:a==='cancel'?'cancel':'move'}));
 }
 if(a==='reconcile'){await mutate('booking',{id,action:'reconcile'});return note('Calendar response checked.');}
 if(a==='retry'){await mutate('retry',{eventId:id});note('Delivery queue checked. Review the latest status.');}
}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b)return;try{await action(b.dataset.action,b.dataset.id);}catch(error){note(message(error));}});
content.addEventListener('change',e=>{const k=e.target.dataset.filter;if(!k)return;const v=e.target.value;
 if(k==='period')filters.year=v==='year';else if(k==='month'){if(!validMonth(v))return;filters.month=v;}else filters[k]=v;render();});
window.addEventListener('hashchange',()=>{if(d)render();});
async function start(){
 if(!demo){
   let me;try{me=await api('/api/me');}
   catch(e){content.innerHTML='<article class="panel"><h2>'+esc(e.status===401?'Open your landlord workspace':'Account service unavailable')+'</h2><p>'+esc(e.status===401?'Sign in with the account that manages your SiLL portfolio.':message(e))+'</p><div class="form-actions"><a class="btn" href="/portal">Open portal</a> <a class="btn secondary" href="/leasing/demo">Explore demo</a></div></article>';return;}
   portfolios=me.portfolios||[];if(!portfolios.length){content.innerHTML='<article class="panel"><h2>Set up your portfolio</h2><p>Create a portfolio from the portal to manage your listings and showings.</p><a class="btn" href="/portal">Open portal</a></article>';return;}
   selected=portfolios[0].id;
 }
 await reload();
}
start().catch(e=>{content.textContent=message(e);});
