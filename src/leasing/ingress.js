import {api,json} from '../api.js';
import {leasingTick} from './delivery.js';
// Optional public machine ingress for an owner-private dashboard.
export default {
  async fetch(req,env,ctx){
    const path=new URL(req.url).pathname;
    if(!['/api/leasing/vapi','/api/leasing/make'].includes(path))return json({error:'Route not found.'},404);
    if(req.method!=='POST')return json({error:'Use POST.'},405);
    try{return await api(req,env,ctx);}
    catch(e){return json({error:e.status?e.message:'The service is temporarily unavailable.'},e.status||503);}
  },
  async scheduled(event,env,ctx){ctx.waitUntil(leasingTick(env));}
};
