export const costs = {
  fees: 'Platform or management fees', utilities: 'Utilities and internet', cleaning: 'Turnover cleaning',
  repairs: 'Repairs paid from operating funds', insurance: 'Insurance', taxes: 'Property taxes',
  hoa: 'HOA costs', financing: 'Financing payments'
};
export const reserves = { replacement: 'Furniture replacement reserve', repairReserve: 'Repair reserve' };
export const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
export function validMonth(value) { return typeof value==='string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && +value.slice(0,4)>=2000 && +value.slice(0,4)<=2200; }
export function cleanAmounts(raw={},plan=false) {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw Error('Enter financial amounts.');
  const out={};
  const ints = [...Object.keys(costs).filter(k=>!plan||k!=='fees'),...Object.keys(reserves),
    ...(plan?['potentialRent','nightlyRate','occupancyBps','feeBps']:['collected'])];
  for (const k of ints) {
    const n=raw[k]??(k==='occupancyBps'?10000:0);
    if (!Number.isSafeInteger(n)||n<0||n>(k.endsWith('Bps')?10000:2_000_000_000)) throw Error('Invalid amount or percentage for '+k+'.');
    out[k]=n;
  }
  for(const k of ['taxesEscrowed','insuranceEscrowed']){
    if(raw[k]!==undefined && typeof raw[k]!=='boolean') throw Error('Check escrow settings.');
    out[k]=raw[k]===true;
  }
  return out;
}
export function monthly(raw,month,mode='actual',type='long') {
  if (!validMonth(month)||!['actual','projected'].includes(mode)||!['short','long'].includes(type)) throw Error('Choose a valid period and scenario.');
  const plan=mode==='projected', input=cleanAmounts(raw,plan);
  const [year,m]=month.split('-').map(Number);
  const days=new Date(Date.UTC(year,m,0)).getUTCDate();
  const gross=plan?(type==='short'?input.nightlyRate*days:input.potentialRent):input.collected;
  const vacancy=plan?Math.round(gross*(10000-input.occupancyBps)/10000):0;
  const income=gross-vacancy;
  const expenses=Object.fromEntries(Object.keys(costs).map(k=>[k,input[k]??0]));
  if(plan) expenses.fees=Math.round(income*input.feeBps/10000);
  if(input.taxesEscrowed) expenses.taxes=0;
  if(input.insuranceEscrowed) expenses.insurance=0;
  const allocations=Object.fromEntries(Object.keys(reserves).map(k=>[k,input[k]]));
  const expenseTotal=Object.values(expenses).reduce((a,b)=>a+b,0);
  const reserveTotal=Object.values(allocations).reduce((a,b)=>a+b,0);
  return {gross,vacancy,income,expenses,allocations,expenseTotal,reserveTotal,net:income-expenseTotal-reserveTotal};
}
export function periodTotal(listings,actuals,period,mode='actual',strategy='configured'){
  const months=period.length===4?Array.from({length:12},(_,i)=>period+'-'+String(i+1).padStart(2,'0')):[period];
  const result=monthly({},months[0]); let included=0;
  const perProperty=[];
  for(const listing of listings){
    const type=strategy==='configured'?listing.rentalType:strategy;
    let propertyNet=0, count=0;
    for(const month of months){
      const input=mode==='actual'?actuals.find(a=>a.listingId===listing.id&&a.month===month)?.amounts:(type==='short'?listing.shortPlan:listing.longPlan);
      if(!input||!Object.keys(input).length) continue;
      const line=monthly(input,month,mode,type);
      for(const k of ['gross','vacancy','income','expenseTotal','reserveTotal','net'])result[k]+=line[k];
      for(const k of Object.keys(costs))result.expenses[k]+=line.expenses[k];
      for(const k of Object.keys(reserves))result.allocations[k]+=line.allocations[k];
      propertyNet+=line.net; count++; included++;
    }
    perProperty.push({id:listing.id,name:listing.name,net:propertyNet,count});
  }
  return {...result,included,expected:listings.length*months.length,perProperty};
}
