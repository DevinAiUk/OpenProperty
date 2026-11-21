import test from 'node:test';
import assert from 'node:assert/strict';
import {monthly,periodTotal} from '../src/leasing/finance.js';
import {officeOpen,matches} from '../src/leasing/validation.js';
test('Actual rent never incurs vacancy, funded reserves are separate, escrow excludes duplicate expense',()=>{
 const r=monthly({collected:200000,fees:10000,utilities:10000,financing:80000,taxes:20000,insurance:10000,taxesEscrowed:true,insuranceEscrowed:true,replacement:5000,repairReserve:4000,occupancyBps:3100},'2028-02');
 assert.equal(r.net,91000);assert.equal(r.vacancy,0);assert.equal(r.expenseTotal,100000);assert.equal(r.reserveTotal,9000);
});
test('Projections use occupied rent for fees, real calendar days and integer cents',()=>{
 const r=monthly({nightlyRate:10000,occupancyBps:8000,feeBps:1000},'2028-02','projected','short');
 assert.equal(r.gross,290000);assert.equal(r.vacancy,58000);assert.equal(r.expenses.fees,23200);assert.equal(r.net,208800);
 assert.throws(()=>monthly({fees:-1},'2028-04'));assert.throws(()=>monthly({},'2028-14'));
});
test('Annual actuals sum entered months only and portfolio projections produce twelve months per property',()=>{
 const listings=[{id:'a',name:'A',rentalType:'long',longPlan:{potentialRent:100000},shortPlan:{nightlyRate:1200}},{id:'b',name:'B',rentalType:'short',shortPlan:{nightlyRate:10000}}];
 const x=periodTotal(listings,[{listingId:'a',month:'2028-02',amounts:{collected:88000}},{listingId:'a',month:'2028-03',amounts:{collected:0}}],'2028');
 assert.deepEqual([x.included,x.expected,x.net],[2,24,88000]);
 assert.equal(periodTotal(listings,[],'2028','projected').net,4860000);
 assert.equal(periodTotal(listings,[],'2028','projected','long').included,12);
});
test('Hours use office timezone; monthly budget never matches nightly prices',()=>{
 const s={timezone:'America/New_York',officeDays:[1],officeStart:'09:00',officeEnd:'17:00',transferEnabled:true,transferNumber:'+12025550101'};
 assert.ok(officeOpen(s,new Date('2026-11-23T14:00:00Z')));assert.equal(officeOpen(s,new Date('2026-11-23T22:00:00Z')),false);
 assert.equal(matches({availability:'Available',rentalType:'short',rent:125},{maxRent:1500}),false);
});
