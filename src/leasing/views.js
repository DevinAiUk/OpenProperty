import {esc,chip,btn,choice,empty,row,panel,when,phase,prop,who} from './ui.js';
import {money,costs,reserves,periodTotal} from './finance.js';
export function overview(d,f,demo){
 const actual=periodTotal(d.listings,d.actuals,f.month),plan=periodTotal(d.listings,d.actuals,f.month,'projected');
 const next=d.bookings.filter(b=>b.status==='confirmed'&&Date.parse(b.start)>Date.now()).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 const inquiries=d.leads.filter(l=>Date.now()-Date.parse(l.createdAt)<30*86400000);
 const jobs=d.deliveries.filter(v=>v.failure&&v.status!=='confirmed');
 const callbacks=d.callbacks.filter(c=>c.status!=='completed'),pending=d.bookings.filter(b=>b.status.includes('pending'));
 const metric=(label,val,note)=>'<article class="metric"><small>'+esc(label)+'</small><strong>'+esc(val)+'</strong><span>'+esc(note)+'</span></article>';
 const attention=[...callbacks.map(c=>row('Callback '+c.status.replace('_',' '),c.reason,btn('Review','open-leads'))),...pending.map(b=>row(phase(b.status),prop(d,b.listingId),btn('Review','open-calendar'))),...jobs.map(j=>row('Delivery needs attention',j.failure,btn('Review','open-settings')))];
 return '<div class="grid stats">'+metric('Monthly cash flow',actual.included?money(actual.net):'—',actual.included+' of '+actual.expected+' actual records')+metric('Projected cash flow',plan.included?money(plan.net):'—','Current month · configured scenarios')+metric('New leads',inquiries.length,'Last 30 days')+metric('Upcoming showings',next.length,demo?'Simulated confirmations':'Calendar-confirmed')+'</div>'+
 '<div class="grid two">'+panel('Upcoming showings',next.slice(0,4).map(b=>row(prop(d,b.listingId),when(b.start,d.settings.timezone)+' · '+who(d,b.leadId),chip(demo?'Simulated':'Confirmed','good'))).join('')||empty('Confirmed showings will appear here.'),btn('Calendar','open-calendar'))+
 panel('Needs attention',attention.slice(0,5).join('')||empty('No open callbacks, booking exceptions, or failed deliveries.'),chip(String(attention.length)))+'</div>'+
 panel('Recent inquiries',d.calls.slice(0,4).map(c=>row(who(d,c.leadId),c.summary||'Call summary pending',chip(c.ended?'Call ended':'In progress'))).join('')||empty('New inquiries appear after intake.'),btn('Leads','open-leads'));
}
export function listings(d){
 const cards=d.listings.map(l=>'<article class="panel listing-card">'+(l.photo?'<img class="listing-photo" alt="'+esc(l.name)+'" referrerpolicy="no-referrer" src="'+esc(l.photo)+'">':'<div class="photo-fallback">No listing photo</div>')+
 '<div class="listing-body">'+chip(l.availability,l.availability==='Available'?'good':'muted')+'<h2>'+esc(l.name)+'</h2><p>'+esc(l.location)+' · '+esc(l.bedrooms===0?'Studio':l.bedrooms+' bedrooms')+'</p><strong class="money">'+money(Math.round(l.rent*100))+'</strong> / '+(l.rentalType==='short'?'night':'month')+'<p>Deposit '+money(Math.round(l.deposit*100))+'</p>'+
 '<p>'+esc(l.address)+'</p><p>'+esc(l.amenities||'No approved amenities entered.')+'</p><small>Available from '+esc(l.availableFrom||'date pending')+'</small><details><summary>Rental requirements</summary><p>'+esc(l.requirements||'Ask the property team.')+'</p></details>'+btn('Edit listing','edit-listing',l.id)+'</div></article>').join('');
 return '<div class="toolbar">'+btn('Add listing','edit-listing','','')+'</div><div class="grid cards">'+(cards||empty('Add your first landlord-approved listing.'))+'</div>';
}
export function leads(d){
 const records=d.leads.map(l=>{const p=l.preferences||{},hist=d.bookings.filter(b=>b.leadId===l.id),calls=d.calls.filter(c=>c.leadId===l.id);
 return '<details class="panel"><summary><strong>'+esc(l.name)+'</strong> '+chip(l.stage)+' '+chip(l.crmStatus,'muted')+'</summary><p>'+esc([l.phone,l.email].filter(Boolean).join(' · '))+'</p>'+
 row('Rental preferences',[p.budget!=null?'Budget '+money(Math.round(p.budget*100)):'',p.location,p.bedrooms!=null?p.bedrooms+' bedrooms':'',p.moveIn?'Move-in '+p.moveIn:'',p.listingId?prop(d,p.listingId):''].filter(Boolean).join(' · ')||'Not provided')+
 calls.map(c=>row('Call summary',c.summary||'Summary pending')+row('Next action',c.nextAction||'Pending')).join('')+hist.map(b=>row('Showing · '+phase(b.status),when(b.start,d.settings.timezone)+' · '+prop(d,b.listingId))).join('')+
 btn('Change follow-up status','stage',l.id)+'</details>';}).join('');
 return panel('Callback requests',d.callbacks.map(c=>row(c.reason,[c.phone,c.email,c.status].filter(Boolean).join(' · '),c.status!=='completed'?btn('Mark complete','callback',c.callId):'')).join('')||empty('No callbacks requested.'))+(records||panel('Leads',empty('Confirmed contact details and stated preferences will appear here.')));
}
export function calendarView(d,demo){
 const tz=d.settings.timezone;
 const bookings=d.bookings.slice().sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)).map(b=>row(prop(d,b.listingId)+' · '+who(d,b.leadId),when(b.start,tz)+' · '+(b.calendarEventId||'Awaiting provider reference'),
  '<div class="form-actions">'+chip(demo&&b.status==='confirmed'?'Simulated':phase(b.status),b.status==='confirmed'?'good':'warn')+(b.status==='confirmed'?btn('Reschedule','reschedule',b.id)+btn('Cancel','cancel',b.id):b.status.includes('pending')?btn('Recheck','reconcile',b.id):'')+'</div>')).join('');
 const open=d.slots.filter(s=>!s.holder&&Date.parse(s.start)>Date.now()).map(s=>row(prop(d,s.listingId),when(s.start,tz),chip('Offered window'))).join('');
 return '<div class="toolbar">'+btn('Add showing window','add-slot','','')+'</div>'+panel('Appointments',bookings||empty('No appointments yet.'))+panel('Showing windows',empty('The assistant checks these windows against the connected calendar before offering a time.')+(open||empty('Add a window to accept showing requests.')));
}
const viewSelect=(label,id,opts,current)=>'<label>'+label+' <select data-filter="'+id+'">'+choice(opts,current)+'</select></label>';
export function financials(d,f){
 const items=f.listing?d.listings.filter(x=>x.id===f.listing):d.listings;
 const period=f.year?f.month.slice(0,4):f.month,calc=periodTotal(items,d.actuals,period,f.mode,f.strategy);
 const isPlan=f.mode==='projected',detail=(label,value)=>row(label,'','<span class="money">'+money(value)+'</span>');
 const controls='<div class="panel toolbar fields">'+viewSelect('Property','listing',[['','Entire portfolio'],...d.listings.map(l=>[l.id,l.name])],f.listing)+viewSelect('Basis','mode',[['actual','Actual results'],['projected','Projection']],f.mode)+viewSelect('View','period',[['month','Monthly'],['year','Annual']],f.year?'year':'month')+
 '<label>Reporting month<input type="month" data-filter="month" min="2000-01" max="2200-12" value="'+esc(f.month)+'"></label>'+(isPlan?viewSelect('Scenario','strategy',[['configured','As configured per property'],['long','Long-term rentals'],['short','Short-term rentals']],f.strategy):'')+'</div>';
 return controls+'<div class="toolbar">'+btn('Edit actuals or assumptions','edit-finance','','')+'</div><div class="grid two">'+panel(isPlan?'Projected cash flow':'Actual cash flow',
 '<p class="money summary '+(calc.net<0?'neg':'pos')+'">'+(calc.included?money(calc.net):'—')+'</p>'+empty(period+' · '+calc.included+' of '+calc.expected+' property-months entered. Missing records are excluded.')+
 '<div class="ledger">'+detail(isPlan?'Potential rent':'Collected rent',calc.gross)+(isPlan?detail('Less vacancy allowance',-calc.vacancy):'')+detail(isPlan?'Rent after vacancy allowance':'Cash rent received',calc.income)+detail('Expenses and financing',-calc.expenseTotal)+detail(isPlan?'Planned reserves':'Reserve contributions',-calc.reserveTotal)+'</div>'+empty('Cash flow after debt payments and reserves. This measure is distinct from accounting or taxable profit.'))+
 panel('Calculation breakdown','<div class="ledger">'+Object.entries(costs).map(([k,label])=>detail(label,calc.expenses[k])).join('')+Object.entries(reserves).map(([k,label])=>detail(label,calc.allocations[k])).join('')+'</div>')+'</div>'+
 panel('Property totals',calc.perProperty.map(p=>row(p.name,p.count+' month'+(p.count===1?'':'s')+' included','<strong>'+esc(p.count?money(p.net):'—')+'</strong>')).join('')||empty('Add a property to calculate its cash flow.'));
}
export function settingsView(d,demo){
 const s=d.settings,c=d.integrations,flags=[['Vapi inbound webhook',c.vapi],['Google Calendar',c.calendar],['Make delivery webhook',c.make],['Make command endpoint',c.commands],['HubSpot direct adapter',c.hubspot]];
 return '<div class="grid two">'+panel('Connections',flags.map(([name,yes])=>row(name,'',chip(demo?'Simulated':yes?'Credentials configured':'Needs credentials',!demo&&yes?'good':'muted'))).join('')+
 empty(demo?'Sample operations run in this tab.':'A provider receipt appears after an operation succeeds.'))+
 panel('Voice and routing',row('Company',s.company)+row('Voice',s.voice+' · '+s.language+' · '+s.pace+'×')+row('Office hours',s.officeStart+'–'+s.officeEnd+' · '+s.timezone)+row('Default data retention',s.recording||s.transcription?'Consent configuration requested':'Audio recording and saved transcripts off')+
 '<div class="form-actions">'+btn('Edit voice settings','edit-settings')+btn('Export Vapi settings','export-voice')+'</div>')+'</div>'+
 panel('CRM and notifications',row('CRM route',s.crmMode==='make'?'Make → HubSpot':'Direct to HubSpot')+row('Landlord notifications',s.notifyEnabled?s.notifyTo:'Off')+btn('Edit connections and mapping','edit-mapping'))+
 panel('Delivery history',d.deliveries.map(j=>row(j.kind,j.failure||j.receipt||'Awaiting provider acknowledgement','<div class="form-actions">'+chip(j.status,j.status==='confirmed'?'good':j.failure?'warn':'muted')+(j.failure?btn('Retry','retry',j.eventId):'')+'</div>')).join('')||empty('CRM and notification receipts will appear here.'));
}
