// Consent-first sales agency: 56 specialist role profiles, draft-only workflow.
const privateAuth=require('../_lib/private-auth');
const AGENTS = require('../data/sales-agents.json');
const DEPARTMENTS = [
  { id:'lead_generation', name:'Lead Generation', agent_count:16, purpose:'Qualify only user-supplied leads; no scraping or invented contacts.' },
  { id:'outreach', name:'Outreach Agents', agent_count:16, purpose:'Prepare opt-in message drafts; never send.' },
  { id:'sales_calling', name:'Sales Calling', agent_count:12, purpose:'Prepare call scripts only for explicit opt-in; never call.' },
  { id:'crm_operations', name:'CRM Operations', agent_count:12, purpose:'Validate records and propose patches; never write to a CRM.' }
];
function text(v,n=500){return v==null?'':String(v).replace(/\s+/g,' ').trim().slice(0,n);}
function yes(v){return v===true || (typeof v==='string' && ['yes','true','1','opted-in','opt_in'].includes(v.trim().toLowerCase()));}
function out(lead){return yes(lead.do_not_contact)||yes(lead.opted_out)||yes(lead.unsubscribe);}
function consent(lead,ch){const c=lead.consent&&typeof lead.consent==='object'?lead.consent:{};const field={email:'email_opt_in',whatsapp:'whatsapp_opt_in',phone:'phone_call_opt_in'}[ch];return yes(lead[field])||yes(c[field]);}
function score(lead){let n=0,r=[];if(text(lead.company)){n++;r.push('company supplied');}if(text(lead.title||lead.role)){n+=2;r.push('buyer role supplied');}if(text(lead.source)){n++;r.push('source supplied');}if(text(lead.intent||lead.need)){n+=2;r.push('explicit need/intent supplied');}if(text(lead.email)||text(lead.phone)){n++;r.push('contact field supplied');}if(['email','whatsapp','phone'].some(c=>consent(lead,c))){n+=2;r.push('channel opt-in recorded');}return {n,r};}
function run(body){
  const goal=text(body.goal,1000)||'Plan a consent-first sales workflow';
  const channel=['email','whatsapp','phone'].includes(String(body.channel||'email').toLowerCase())?String(body.channel||'email').toLowerCase():'email';
  const base={run_id:`sales-${Date.now()}-${Math.random().toString(16).slice(2,8)}`,goal,channel,pipeline:['lead_generation','outreach','sales_calling','crm_operations'],agents_available:AGENTS.length,human_approval_required:true,external_actions_performed:[],safety:['Only supplied leads used; no enrichment/scraping.','No email or WhatsApp sent.','No calls placed.','No CRM writes.','Raw lead rows are not persisted.']};
  if(!Array.isArray(body.leads))return {...base,status:'needs_input',summary:'Sales plan ready. Supply a consented lead list or approved data connector; no Apollo/CRM/email/phone provider is connected.',required_input:'leads[]: id, company, name, title, email, phone, source, intent, email_opt_in, whatsapp_opt_in, phone_call_opt_in, do_not_contact',actions:[],agents_used:AGENTS.filter(a=>['icp_research_analyst','lead_score_analyst','consent_optout_guard','crm_field_mapper'].includes(a.id))};
  if(body.leads.length>500)return {...base,status:'error',summary:'Maximum 500 leads per preview run.',actions:[]};
  const seen=new Set(), unique=[];let duplicates=0,invalid=0;
  body.leads.forEach((raw,i)=>{if(!raw||typeof raw!=='object'||Array.isArray(raw)){invalid++;return;}if(!['id','email','company','name','first_name','phone'].some(k=>text(raw[k]))){invalid++;return;}const email=text(raw.email,254).toLowerCase();const fallback=`${text(raw.company,160).toLowerCase()}|${text(raw.name||raw.first_name,160).toLowerCase()}`;const key=email||fallback||`row:${i}`; if(seen.has(key)){duplicates++;return;}seen.add(key);unique.push({ref:text(raw.id,80)||`lead-${i+1}`,lead:raw});});
  const qualified=[],excluded=[],outreach=[],calls=[],crm=[];
  unique.forEach(({ref,lead})=>{
    const s=score(lead),blocked=out(lead),ok=s.n>=5&&!blocked;
    const stage=blocked?'do_not_contact':ok?'qualified':'needs_research';
    const row={lead_ref:ref,score:s.n,score_max:9,qualified:ok,reasons:s.r,do_not_contact:blocked,suggested_stage:stage};
    (ok?qualified:excluded).push(row);
    const name=(text(lead.first_name||lead.name,80).split(' ')[0]||'there'),company=text(lead.company,120)||'your team',need=text(lead.intent||lead.need,180);
    if(blocked)outreach.push({type:`${channel}_outreach`,lead_ref:ref,status:'blocked_opt_out',sent:false});
    else if(!ok)outreach.push({type:`${channel}_outreach`,lead_ref:ref,status:'blocked_insufficient_qualification',sent:false});
    else if(channel==='email'&&text(lead.email)&&consent(lead,'email'))outreach.push({type:'email_draft',lead_ref:ref,status:'awaiting_human_review',subject:`A quick idea for ${company}`,body:`Hi ${name},\n\nI’m reaching out because ${company} may be a fit for a conversation about [verified value proposition].${need?' I noticed you mentioned '+need+'.':''}\n\nWould a short, no-pressure discussion be useful? If not, reply ‘no thanks’ and I won’t follow up.\n\n[Your name / company]`,sent:false});
    else if(channel==='whatsapp'&&text(lead.phone)&&consent(lead,'whatsapp'))outreach.push({type:'whatsapp_draft',lead_ref:ref,status:'awaiting_human_review',body:`Hi ${name}, this is [your name] from [company]. You opted in to hear about [topic]. Is a short overview useful? Reply STOP any time.`,sent:false});
    else if(channel==='phone')outreach.push({type:'phone_handoff',lead_ref:ref,status:'see_sales_calling_stage',placed:false});
    else outreach.push({type:`${channel}_outreach`,lead_ref:ref,status:'blocked_no_explicit_channel_opt_in',sent:false});
    if(blocked)calls.push({type:'call_script',lead_ref:ref,status:'blocked_opt_out',placed:false});
    else if(!ok)calls.push({type:'call_script',lead_ref:ref,status:'blocked_insufficient_qualification',placed:false});
    else if(text(lead.phone)&&consent(lead,'phone'))calls.push({type:'call_script_draft',lead_ref:ref,status:'awaiting_human_review',placed:false,script:`Hi ${name}, this is [your name] from [company]. You opted in to a call. Is now a good time? I’d like to understand ${need||'whether this is relevant to your team'}. If not, I can stop here or arrange another time.`});
    else calls.push({type:'call_script',lead_ref:ref,status:'blocked_no_explicit_call_opt_in',placed:false});
    crm.push({type:'crm_patch_proposal',lead_ref:ref,status:'awaiting_human_review',patch:{pipeline_stage_suggestion:stage,score:s.n},applied:false});
  });
  return {...base,status:'draft_ready',summary:`Reviewed ${unique.length} supplied lead(s): ${qualified.length} qualified, ${excluded.length} excluded/needs research, ${duplicates} duplicate(s). Draft-only; nothing sent, called, or written.`,counts:{input:body.leads.length,valid_unique:unique.length,qualified:qualified.length,excluded_or_needs_research:excluded.length,duplicates,invalid_rows:invalid,draft_actions:outreach.length+calls.length+crm.length},lead_scores:qualified.concat(excluded),actions:{outreach,sales_calling:calls,crm_operations:crm},agents_used:AGENTS.filter(a=>['icp_research_analyst','lead_score_analyst','lead_data_validator','email_personalization_writer','consent_optout_guard','call_eligibility_verifier','call_script_drafter','crm_field_mapper','lead_stage_recommender'].includes(a.id))};
}
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store, max-age=0');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET'&&req.method!=='POST')return privateAuth.json(res,405,{error:'method_not_allowed'});
  if(req.method==='POST'&&!privateAuth.requestIsSameOrigin(req))return privateAuth.json(res,403,{error:'same_origin_required'});
  const user=await privateAuth.requireUser(req,res);if(!user)return;
  let body={};
  if(req.method==='POST'){
    const parsed=privateAuth.parseJsonBody(req,1000000);
    if(parsed.error)return privateAuth.json(res,400,{error:parsed.error});
    body=parsed.body;
  }
  if(req.method==='GET'){
    const view=(req.query&&req.query.view)||'departments';
    if(view==='agents'){
      const dept=(req.query&&req.query.department)||'';const q=String((req.query&&req.query.q)||'').toLowerCase().trim();
      const rows=AGENTS.filter(a=>(!dept||a.department===dept)&&(!q||(a.name+' '+a.mission+' '+a.department).toLowerCase().includes(q)));
      return res.status(200).json({count:rows.length,agents:rows});
    }
    return res.status(200).json({count:AGENTS.length,departments:DEPARTMENTS});
  }
  if(req.method==='POST'){
    if(Object.prototype.hasOwnProperty.call(body,'leads')&&body.leads!==null&&!Array.isArray(body.leads))return res.status(400).json({error:'leads must be an array of objects'});
    const result=run(body);
    return res.status(result.status==='error'?400:200).json(result);
  }
  return res.status(405).json({error:'method not allowed'});
};
