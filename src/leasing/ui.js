export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const chip=(v,kind='muted')=>'<span class="chip '+kind+'">'+esc(v)+'</span>';
export const btn=(label,action,id='',style='secondary small')=>'<button type="button" class="btn '+style+'" data-action="'+esc(action)+'" data-id="'+esc(id)+'">'+esc(label)+'</button>';
export const choice=(items,selected)=>items.map(it=>{const [v,label]=Array.isArray(it)?it:[it,it];return '<option value="'+esc(v)+'"'+(String(v)===String(selected)?' selected':'')+'>'+esc(label)+'</option>';}).join('');
export const field=(text,name,value='',type='text',opts='')=>'<label>'+esc(text)+'<input name="'+esc(name)+'" type="'+type+'" value="'+esc(value)+'" '+opts+'></label>';
export const select=(text,name,items,value)=>'<label>'+esc(text)+'<select name="'+name+'">'+choice(items,value)+'</select></label>';
export const area=(text,name,value='')=>'<label class="field-wide">'+esc(text)+'<textarea rows="2" name="'+name+'">'+esc(value)+'</textarea></label>';
export const check=(text,name,on)=>'<label class="check"><input type="checkbox" name="'+name+'"'+(on?' checked':'')+'>'+esc(text)+'</label>';
export const empty=s=>'<p class="sub">'+esc(s)+'</p>';
export const row=(a,b='',tag='')=>'<div class="row"><div><strong>'+esc(a)+'</strong>'+(b?'<small>'+esc(b)+'</small>':'')+'</div>'+tag+'</div>';
export const panel=(title,html,action='')=>'<article class="panel"><div class="panel-head"><h2>'+esc(title)+'</h2>'+action+'</div>'+html+'</article>';
export const when=(v,tz)=>v?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:tz,timeZoneName:'short'}).format(new Date(v)):'';
export const phase=v=>({pending:'Awaiting calendar',cancel_pending:'Cancellation pending',move_pending:'Reschedule pending',confirmed:'Confirmed',cancelled:'Cancelled',conflict:'Conflict'}[v]||v);
export const prop=(d,id)=>d.listings.find(l=>l.id===id)?.name||'Property';
export const who=(d,id)=>d.leads.find(l=>l.id===id)?.name||'Caller';
export const ttl=s=>s.charAt(0).toUpperCase()+s.slice(1);
export const form=(html,button)=>'<form id="edit-form"><div class="fields">'+html+'</div><div class="form-actions"><button class="btn" type="submit">'+esc(button)+'</button></div></form>';

