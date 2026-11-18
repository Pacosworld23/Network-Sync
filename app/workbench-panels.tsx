'use client';

import {useMemo,useState} from 'react';
import {ArrowRight,ArrowUpRight,Building2,ChevronDown,Download,GitBranch,LayoutGrid,List,Search,ShieldAlert,Sparkles} from 'lucide-react';

export const ACCOUNT_POLICY_VERSION=2;

export function probability(row:any,name:string){
  const answer=row.analysis?.answers?.find((item:any)=>item.name===name);
  return answer?.type==='predicate'?answer.probability:null;
}

export function eligibleForWarmIntro(row:any){
  const cohort=accountCohort(row);
  const fit=probability(row,'screen_icp');
  return cohort==='strong'||cohort==='promising'||(fit!=null&&fit>=.3);
}

export function accountCohort(row:any){
  if(row.analysis?.version!==ACCOUNT_POLICY_VERSION)return 'unassessed';
  const fit=probability(row,'screen_icp');
  const need=probability(row,'screen_control_need');
  const risk=probability(row,'screen_build_risk');
  if(fit==null||need==null||risk==null)return 'unassessed';
  if(risk>=.65)return 'build-risk';
  if(fit>=.72&&need>=.55)return 'strong';
  if(fit>=.5)return 'promising';
  return 'low';
}

const cohortCopy:any={
  strong:{title:'Strong ICP pattern',tone:'positive',description:'Looks like Hicap’s target market and shows a plausible shared-control need.',next:'Validate the owner and active control problem.'},
  promising:{title:'Promising — validate',tone:'promising',description:'The company shape fits, but the control problem or buying context is still unclear.',next:'Research AI adoption and governance ownership.'},
  'build-risk':{title:'AI-native / build risk',tone:'risk',description:'May already have internal control infrastructure or prefer to build it.',next:'Confirm whether internal tooling is actually sufficient.'},
  low:{title:'Lower fit',tone:'low',description:'The available company identity does not closely match Hicap’s target profile.',next:'Deprioritize unless new evidence changes the picture.'},
  unassessed:{title:'Not screened yet',tone:'neutral',description:'No current Decisions screen exists for these companies.',next:'Run the portfolio screen to classify them.'},
};

function percent(value:number|null){return value==null?'—':`${Math.round(value*100)}%`;}

export function AccountAnalysis({accounts,busy,progress,onScreen,onPick,onImport,onExport}:{accounts:any[],busy:boolean,progress:number,onScreen:()=>void,onPick:(row:any)=>void,onImport:()=>void,onExport:()=>void}){
  const [view,setView]=useState<'analysis'|'all'>('analysis');
  const [query,setQuery]=useState('');
  const [open,setOpen]=useState<Record<string,boolean>>({strong:true,promising:true});
  const groups=useMemo(()=>Object.fromEntries(Object.keys(cohortCopy).map(key=>[key,accounts.filter(row=>accountCohort(row)===key)])),[accounts]);
  const screened=accounts.length-groups.unassessed.length;
  const avg=(items:any[])=>items.length?Math.round(items.reduce((sum,row)=>sum+(probability(row,'screen_icp')||0),0)/items.length*100):null;
  const filtered=accounts.filter(row=>`${row.name} ${row.domain}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <div className="portfolio-summary">
      <div><span>Strong ICP</span><strong>{groups.strong.length}</strong><small>Best pattern match</small></div>
      <div><span>Promising</span><strong>{groups.promising.length}</strong><small>Worth validating</small></div>
      <div><span>Build risk</span><strong>{groups['build-risk'].length}</strong><small>Likely internal solution</small></div>
      <div><span>Screened</span><strong>{screened}<i>/{accounts.length}</i></strong><small>Fast routing estimates</small></div>
    </div>
    <article className="tablepanel portfolio">
      <div className="panelhead">
        <div className="tabs">
          <button className={view==='analysis'?'chosen':''} onClick={()=>setView('analysis')}>Portfolio analysis</button>
          <button className={view==='all'?'chosen':''} onClick={()=>setView('all')}>All accounts <span>{accounts.length}</span></button>
        </div>
        <div className="panel-actions"><button className="textbutton" onClick={onExport}><Download size={14}/> Export</button><button className="primary" disabled={busy||!groups.unassessed.length} onClick={onScreen}><Sparkles size={15}/>{busy?`Screening ${progress}/${groups.unassessed.length||accounts.length}`:groups.unassessed.length?'Screen all accounts':'Screen is current'}</button></div>
      </div>
      {view==='analysis'?<div className="cohort-list">
        <div className="method-note"><ShieldAlert size={17}/><div><b>Portfolio screen</b><p>These groups are fast routing estimates from company identity and available evidence. Open a company to run the stricter evidence based qualification before outreach.</p></div></div>
        {Object.entries(cohortCopy).map(([key,copy]:any)=>{const items=groups[key];const expanded=!!open[key];return <section className={`cohort ${copy.tone}`} key={key}>
          <button className="cohort-head" onClick={()=>setOpen({...open,[key]:!expanded})} aria-expanded={expanded}>
            <span className="cohort-marker"/><span className="cohort-copy"><b>{copy.title}</b><small>{copy.description}</small></span>
            <span className="cohort-metric"><b>{items.length}</b><small>{avg(items)==null?'Awaiting screen':`${avg(items)}% avg pattern fit`}</small></span><ChevronDown className={expanded?'rotate':''} size={18}/>
          </button>
          {expanded&&<div className="cohort-body"><p className="next-step"><b>Next move:</b> {copy.next}</p>{items.length?<div className="company-grid">{items.map((row:any)=><button key={row.id} className="company-card" onClick={()=>onPick(row)}><span className="logoletter">{row.name.slice(0,1)}</span><span><b>{row.name}</b><small>{row.domain||'Domain not supplied'}</small></span><span className="mini-score">{percent(probability(row,'screen_icp'))}<small>fit</small></span><ArrowUpRight size={15}/></button>)}</div>:<p className="empty-row">No companies in this group.</p>}</div>}
        </section>})}
      </div>:<>
        <div className="toolbar"><label className="search"><Search size={17}/><input placeholder="Search accounts…" value={query} onChange={e=>setQuery(e.target.value)}/></label><span className="muted">Company-by-company detail</span></div>
        <div className="tablewrap"><table><thead><tr><th>ACCOUNT</th><th>PORTFOLIO GROUP</th><th>ICP PATTERN</th><th>EVIDENCE STATUS</th><th/></tr></thead><tbody>{filtered.map(row=><tr key={row.id} onClick={()=>onPick(row)}><td><div className="accountcell"><span className="logoletter">{row.name.slice(0,1)}</span><div><b>{row.name}</b><small>{row.domain||'Domain not supplied'}</small></div></div></td><td><span className={`tag ${cohortCopy[accountCohort(row)].tone}`}>{cohortCopy[accountCohort(row)].title}</span></td><td><span className="score">{percent(probability(row,'screen_icp'))}</span></td><td><span className="tag">{row.analysis?.status||'Not researched'}</span></td><td><ArrowUpRight size={16}/></td></tr>)}</tbody></table></div>
      </>}
      {!accounts.length&&<div className="empty"><Building2 size={32}/><h3>Import a target list.</h3><p>The portfolio analysis will group companies by likely ICP pattern and the next validation step.</p><button className="primary" onClick={onImport}>Import list <ArrowRight size={15}/></button></div>}
    </article>
  </>;
}

export function IntroPaths({directPaths,introLeads,busy,linkedIn,discover,pick}:{directPaths:any[],introLeads:any[],busy:boolean,linkedIn:boolean,discover:()=>void,pick:(row:any)=>void}){
  const total=directPaths.length+introLeads.length;
  return <article className="tablepanel"><div className="panelhead"><div><h3>Likely buyers and warm paths</h3><small>Warm paths first; fallback buyers are clearly marked as cold</small></div><span>{total} candidates</span></div>{directPaths.map(({a,c}:any)=><div className="path" key={'direct-'+a.id+c.id}><div className="avatar">{c.name[0]}</div><div><b>{c.name}</b><small>{c.title||'Title unknown'}</small></div><ArrowRight size={20}/><div><b>{a.name}</b><small>{a.domain}</small></div><span className="tag green">Direct connection</span><button onClick={()=>pick(c)}>Review</button></div>)}{introLeads.map((lead:any)=>{const warm=lead.networkDistance==='DISTANCE_1'||lead.sharedRelations>0;return <div className="path" key={lead.id}><div className="avatar">{lead.name[0]}</div><div><b>{lead.name}</b><small>{lead.title||'Title unknown'}{lead.networkOwner&&` · via ${lead.networkOwner}`}</small>{lead.buyerLikelihood>0&&<small>{Math.round(lead.buyerLikelihood*100)}% role-likelihood estimate</small>}</div><ArrowRight size={20}/><div><b>{lead.accountName}</b><small>{lead.accountDomain}</small></div><span className={'tag '+(warm?'green':'risk')}>{lead.networkDistance==='DISTANCE_1'?'Direct connection':lead.sharedRelations>0?`${lead.sharedRelations} shared connection${lead.sharedRelations===1?'':'s'}`:lead.buyerSearchMode==='decisions-role-fallback'?'Decisions-suggested buyer role':lead.buyerSearchMode==='fallback-ranked'?'Likely buyer — cold fallback':'Likely buyer — cold path'}</span>{lead.linkedin&&<a className="textbutton" href={lead.linkedin} target="_blank" rel="noreferrer">LinkedIn <ArrowUpRight size={14}/></a>}</div>})}{!total&&<div className="empty"><GitBranch size={32}/><h3>Search the target accounts for a path.</h3><p>Find likely technical buyers, then surface direct and shared LinkedIn relationships. If no clear buyer appears, the search returns the three best fallback candidates.</p><button className="primary" disabled={busy||!linkedIn} onClick={discover}>Scan next 5 accounts <ArrowRight size={15}/></button></div>}</article>;
}

export function NetworkTargets({accounts,introLeads,busy,linkedIn,discover,pick,viewConnections,setStage}:{accounts:any[],introLeads:any[],busy:boolean,linkedIn:boolean,discover:(options?:{ids?:string[],count?:number})=>void,pick:(row:any)=>void,viewConnections:()=>void,setStage:(id:string,stage:string)=>void}){
  const [view,setView]=useState<'list'|'board'>('board');
  const [selected,setSelected]=useState<string[]>([]);
  const [count,setCount]=useState(5);
  const eligible=accounts.filter(eligibleForWarmIntro).sort((a,b)=>(probability(b,'screen_icp')||0)-(probability(a,'screen_icp')||0));
  const ready=eligible.filter(account=>account.introPolicyVersion!==5);
  const scanned=eligible.length-ready.length;
  const warmFor=(account:any)=>introLeads.filter(lead=>lead.accountId===account.id&&(lead.sharedRelations>0||lead.networkDistance==='DISTANCE_1'));
  const leadsFor=(account:any)=>introLeads.filter(lead=>lead.accountId===account.id);
  const withPaths=eligible.filter(account=>warmFor(account).length).length;
  const stageFor=(account:any)=>['icp','warm','buyer','outbound'].includes(account.pipelineStage)?account.pipelineStage:warmFor(account).length?'warm':account.introPolicyVersion===5&&leadsFor(account).length?'buyer':'icp';
  const columns=[
    {key:'icp',title:'ICP accounts',note:'Ready or searched without a path'},
    {key:'warm',title:'Warm intro',note:'Direct or shared connection'},
    {key:'buyer',title:'Alternative strong buyer',note:'Cold fallback when no warm path exists'},
    {key:'outbound',title:'Added to outbound campaign',note:'Approved for outreach'},
  ];
  const selectedReady=selected.filter(id=>ready.some(account=>account.id===id));
  function toggle(id:string){setSelected(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);}
  function runSearch(){discover(selectedReady.length?{ids:selectedReady}:{count});setSelected([]);}
  return <article className="tablepanel target-network">
    <div className="panelhead"><div><h3>ICP accounts to search for warm intros</h3><small>Choose the accounts and batch size, then track every result through the workflow</small></div><div className="panel-actions"><button onClick={viewConnections}>View connections</button><div className="view-toggle"><button className={view==='board'?'chosen':''} onClick={()=>setView('board')}><LayoutGrid size={14}/> Board</button><button className={view==='list'?'chosen':''} onClick={()=>setView('list')}><List size={14}/> List</button></div></div></div>
    <div className="target-controls"><div className="target-summary"><span><b>{eligible.length}</b> eligible</span><span><b>{scanned}</b> searched</span><span><b>{withPaths}</b> warm paths</span><span><b>{selectedReady.length}</b> selected</span></div><div className="search-controls"><label>Accounts<select value={count} onChange={event=>setCount(Number(event.target.value))} disabled={!!selectedReady.length}><option value={5}>5 accounts</option><option value={20}>20 accounts</option><option value={30}>30 accounts</option><option value={9999}>Every account</option></select></label><button className="primary" disabled={busy||!linkedIn||(!ready.length&&!selectedReady.length)} onClick={runSearch}><GitBranch size={15}/>{busy?'Searching LinkedIn…':selectedReady.length?`Search ${selectedReady.length} selected`:ready.length?(count>=ready.length?`Search all ${ready.length}`:`Search next ${count}`):'All targets searched'}</button></div></div>
    {view==='board'?<div className="kanban">{columns.map(column=>{const items=eligible.filter(account=>stageFor(account)===column.key);return <section className="kanban-column" key={column.key}><div className="kanban-head"><div><b>{column.title}</b><small>{column.note}</small></div><span>{items.length}</span></div><div className="kanban-stack">{items.map(account=>{const warm=warmFor(account),leads=leadsFor(account),top=leads[0],named=leads.filter(lead=>!lead.synthetic);return <article className="prospect-card" key={account.id}><button className="prospect-main" onClick={()=>pick(account)}><span className="logoletter">{account.name.slice(0,1)}</span><span><b>{account.name}</b><small>{account.domain||'Domain not supplied'}</small></span><span className="mini-score">{percent(probability(account,'screen_icp'))}</span></button><div className="prospect-meta"><span className={'tag '+(account.introPolicyVersion===5?'green':'')}>{account.introPolicyVersion===5?'Searched':'Not searched'}</span><small>{warm.length?`${warm.length} warm path${warm.length===1?'':'s'}`:named.length?`${top?.name}${named.length>1?` +${named.length-1} more`:''}`:leads.length?`${leads.length} role hypothes${leads.length===1?'is':'es'}`:'No buyer path yet'}</small></div>{column.key==='icp'&&account.introPolicyVersion!==5&&<label className="select-account"><input type="checkbox" checked={selected.includes(account.id)} onChange={()=>toggle(account.id)}/> Select for search</label>}<label className="stage-select">Move to<select value={column.key} onChange={event=>setStage(account.id,event.target.value)}><option value="icp">ICP accounts</option><option value="warm">Warm intro</option><option value="buyer">Alternative buyer</option><option value="outbound">Outbound campaign</option></select></label></article>})}{!items.length&&<p className="empty-column">No accounts here yet.</p>}</div></section>})}</div>:<>{ready.length>0&&<div className="select-bar"><label><input type="checkbox" checked={selectedReady.length===ready.length} onChange={()=>setSelected(selectedReady.length===ready.length?[]:ready.map(account=>account.id))}/> Select all unsearched accounts</label></div>}{eligible.map(account=>{const leads=leadsFor(account),warm=warmFor(account),named=leads.filter(lead=>!lead.synthetic);return <div className="target-row selectable" key={account.id}><label className="row-check"><input type="checkbox" disabled={account.introPolicyVersion===5} checked={selected.includes(account.id)} onChange={()=>toggle(account.id)}/></label><button className="target-company" onClick={()=>pick(account)}><span className="logoletter">{account.name.slice(0,1)}</span><span><b>{account.name}</b><small>{account.domain||'Domain not supplied'}</small></span></button><span className={`tag ${cohortCopy[accountCohort(account)]?.tone||''}`}>{cohortCopy[accountCohort(account)]?.title||'30%+ match'}</span><span className="target-fit"><b>{percent(probability(account,'screen_icp'))}</b><small>ICP pattern</small></span><span className="target-paths"><b>{warm.length}</b><small>{warm.length?'warm paths':named.length?`${named.length} named buyers`:`${leads.length} role hypotheses`}</small></span><span className={'tag '+(account.introPolicyVersion===5?'green':'')}>{account.introPolicyVersion===5?`Searched ${account.introScannedAt?new Date(account.introScannedAt).toLocaleDateString():''}`:'Ready to search'}</span></div>})}</>}
    {!eligible.length&&<div className="empty"><Building2 size={30}/><h3>No eligible target accounts yet.</h3><p>Screen the account portfolio first. Companies at or above 30% will flow into this network queue.</p></div>}
  </article>;
}
