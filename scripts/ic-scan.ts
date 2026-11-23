// npx tsx scripts/ic-scan.ts
//
// Comprehensive walk-forward IC scan — 15 factors vs forward SM alpha 180d.
// Every factor uses ONLY pre-trade-date information (temporal firewall).
// Reports Pearson IC + Spearman IC + per-classification breakdown.
//
// Factors:
//  F01 Sector prior mean α         (running mean of completed trades by sector)
//  F02 PIT cap log10               (log market cap at trade time)
//  F03 Cluster buy count 30d       (distinct insiders bought same ticker prior 30d)
//  F04 Stake increase %            (shares / prior holdings, log1p)
//  F05 Holdings change (log shares)(log10 of absolute share count transacted)
//  F06 Track record LOO            (LOO avg SM alpha of prior completed buys by insider)
//  F07 Classification prior mean   (running mean SM alpha by OPP/UNCL/ROUT category)
//  F08 Direction                   (computed cross buys+sells: +1 buy / -1 sell)
//  F09 Role prior mean α           (running mean by role)
//  F10 log Trade Size              (log10 of $ value)
//  F11 Price momentum 90d          (stock return T-90d→T, from CSV price history)
//  F12 Days since last trade       (calendar days since insider's prior trade)
//  F13 Insider breadth 90d         (distinct insiders traded ticker any dir, prior 90d)
//  F14 Filing lag                  (days: transaction_date → Form 4 filed_at)
//  F15 Pre-trade volatility        (std of log returns in 90d before T, per ticker)

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

// ─── Env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
  const p = path.join(__dirname, '..', '.env.local')
  for (const line of fs.readFileSync(p,'utf-8').split('\n')) {
    const t=line.trim(); if(!t||t.startsWith('#')) continue
    const eq=t.indexOf('='); if(eq<0) continue
    const k=t.slice(0,eq).trim(), v=t.slice(eq+1).trim().replace(/^["']|["']$/g,'')
    if(!process.env[k]) process.env[k]=v
  }
}
loadEnv()
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!)
const yf = new YahooFinance()
const slp = (ms:number) => new Promise(r=>setTimeout(r,ms))

// ─── CSV ─────────────────────────────────────────────────────────────────────
function parseCsv(line: string): string[] {
  const f:string[]=[]; let cur='',inQ=false
  for(let i=0;i<line.length;i++){
    const ch=line[i]
    if(ch==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++}else inQ=!inQ}
    else if(ch===','&&!inQ){f.push(cur);cur=''}else cur+=ch
  }
  f.push(cur);return f
}
const pn=(v:string):number|null=>{const n=parseFloat(v);return isNaN(n)?null:n}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function addD(s:string,n:number):string{const d=new Date(s);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().split('T')[0]}
function daysBetween(a:string,b:string):number{return Math.round((new Date(b).getTime()-new Date(a).getTime())/86400000)}

// ─── Price helpers ────────────────────────────────────────────────────────────
function buildPM(quotes:any[]):Map<string,number>{
  const m=new Map<string,number>()
  for(const q of quotes) if(q?.date!=null&&(q?.adjClose??q?.close)!=null)
    m.set(new Date(q.date).toISOString().split('T')[0],q.adjClose??q.close)
  return m
}
function lookupP(m:Map<string,number>,d:string):number|null{
  for(let i=0;i<=7;i++){const dt=new Date(d);dt.setUTCDate(dt.getUTCDate()+i);const p=m.get(dt.toISOString().split('T')[0]);if(p!=null)return p}
  return null
}

// ─── PIT ─────────────────────────────────────────────────────────────────────
function pitTier(mc:number|null):string{
  if(mc==null)return 'No data'
  if(mc<300e6)return 'Micro';if(mc<2e9)return 'Small'
  if(mc<10e9)return 'Mid';if(mc<200e9)return 'Large';return 'Mega'
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function pearson(xs:number[],ys:number[]):number{
  const n=xs.length;if(n<10||ys.length!==n)return NaN
  const mx=xs.reduce((a,b)=>a+b,0)/n,my=ys.reduce((a,b)=>a+b,0)/n
  let cov=0,sx=0,sy=0
  for(let i=0;i<n;i++){const dx=xs[i]-mx,dy=ys[i]-my;cov+=dx*dy;sx+=dx*dx;sy+=dy*dy}
  const d=Math.sqrt(sx*sy);return d<1e-12?NaN:cov/d
}
function rankArr(arr:number[]):number[]{
  const n=arr.length,r=new Array<number>(n)
  const s=[...arr].map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v)
  for(let i=0;i<n;i++)r[s[i].i]=i+1
  return r
}
function spearman(xs:number[],ys:number[]):number{
  if(xs.length!==ys.length||xs.length<10)return NaN
  return pearson(rankArr(xs),rankArr(ys))
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(){
  const CSV=path.join(__dirname,'..','output','backtest-universe.csv')
  console.log('Reading CSV...')
  const lines=fs.readFileSync(CSV,'utf-8').split('\n').filter(Boolean)
  const hdr=parseCsv(lines[0]),idx=(n:string)=>hdr.indexOf(n)

  const C={
    id:               idx('id'),
    insider_cik:      idx('insider_cik'),
    ticker:           idx('ticker'),
    classification:   idx('classification'),
    direction:        idx('direction'),
    transaction_code: idx('transaction_code'),
    transaction_date: idx('transaction_date'),
    price_entry:      idx('price_entry'),
    total_value:      idx('total_value'),
    shares:           idx('shares'),
    shares_owned_after:idx('shares_owned_after'),
    return_180d:      idx('return_180d'),
    spy_return_180d:  idx('spy_return_180d'),
    role_classified:  idx('role_classified'),
    sector:           idx('sector'),
  }

  type Row={id:string;insider_cik:string;ticker:string;classification:string
    direction:string;transaction_code:string;transaction_date:string
    price_entry:number|null;total_value:number|null
    shares:number|null;shares_owned_after:number|null
    return_180d:number|null;spy_return_180d:number|null
    role_classified:string;sector:string}

  const rawRows:Row[]=lines.slice(1).map(l=>{const f=parseCsv(l);return{
    id:f[C.id]??'',insider_cik:f[C.insider_cik]??'',ticker:f[C.ticker]??'',
    classification:f[C.classification]??'',direction:f[C.direction]??'',
    transaction_code:f[C.transaction_code]??'',transaction_date:f[C.transaction_date]??'',
    price_entry:pn(f[C.price_entry]),total_value:pn(f[C.total_value]),
    shares:pn(f[C.shares]),shares_owned_after:pn(f[C.shares_owned_after]),
    return_180d:pn(f[C.return_180d]),spy_return_180d:pn(f[C.spy_return_180d]),
    role_classified:f[C.role_classified]??'',sector:f[C.sector]??''
  }})
  console.log(`  ${rawRows.length.toLocaleString()} rows`)

  // ── Market caps ───────────────────────────────────────────────────────────
  console.log('Fetching market caps...')
  const mcMap=new Map<string,number|null>()
  const tickers=[...new Set(rawRows.map(r=>r.ticker))]
  for(let i=0;i<tickers.length;i+=500){
    const{data}=await supabase.from('tickers').select('symbol,market_cap').in('symbol',tickers.slice(i,i+500))
    for(const r of data??[])mcMap.set((r as any).symbol,(r as any).market_cap??null)
  }
  const latestP=new Map<string,number>()
  for(const r of rawRows)if(r.price_entry!=null){const c=latestP.get(r.ticker);if(!c||r.price_entry>c)latestP.set(r.ticker,r.price_entry)}

  // ── MDY + IWM ─────────────────────────────────────────────────────────────
  const allDates=rawRows.map(r=>r.transaction_date).filter(Boolean).sort()
  const fStart=new Date('2021-01-01'),fEnd=new Date(addD(allDates.at(-1)!,195))
  console.log('Fetching MDY...');await slp(300)
  let mdyMap=new Map<string,number>()
  try{const ch:any=await yf.chart('MDY',{period1:fStart,period2:fEnd,interval:'1d'});mdyMap=buildPM(Array.isArray(ch?.quotes)?ch.quotes:[]);console.log(`  ${mdyMap.size} pts`)}
  catch(e:any){console.error('MDY:',e.message);process.exit(1)}
  await slp(300);console.log('Fetching IWM...')
  let iwmMap=new Map<string,number>()
  try{const ch:any=await yf.chart('IWM',{period1:fStart,period2:fEnd,interval:'1d'});iwmMap=buildPM(Array.isArray(ch?.quotes)?ch.quotes:[]);console.log(`  ${iwmMap.size} pts`)}
  catch(e:any){console.error('IWM:',e.message);process.exit(1)}

  // ── SM alpha for ALL complete trades ──────────────────────────────────────
  type EnrichedRow=Row&{sm_alpha:number;pit_mc:number|null;pit_tier:string;log_pit_mc:number|null}
  const enriched:EnrichedRow[]=[]
  for(const r of rawRows){
    if(r.return_180d==null)continue
    const mc_t=mcMap.get(r.ticker)??null,p_t=latestP.get(r.ticker)??null
    let mc_pit:number|null=null
    if(mc_t!=null&&p_t!=null&&p_t>0&&r.price_entry!=null&&r.price_entry>0)mc_pit=(mc_t/p_t)*r.price_entry
    const tier=pitTier(mc_pit)
    let bm:number|null=null
    if(tier==='Large'||tier==='Mega')bm=r.spy_return_180d??null
    else if(tier==='Mid'){const p0=lookupP(mdyMap,r.transaction_date),p1=lookupP(mdyMap,addD(r.transaction_date,180));bm=(p0&&p1)?Math.round(((p1-p0)/p0)*10000)/100:null}
    else{const p0=lookupP(iwmMap,r.transaction_date),p1=lookupP(iwmMap,addD(r.transaction_date,180));bm=(p0&&p1)?Math.round(((p1-p0)/p0)*10000)/100:null}
    if(bm==null)continue
    enriched.push({...r,sm_alpha:Math.round((r.return_180d-bm)*100)/100,pit_mc:mc_pit,pit_tier:tier,log_pit_mc:mc_pit!=null&&mc_pit>0?Math.log10(mc_pit):null})
  }
  const allComplete=enriched
  const buys=enriched.filter(r=>r.direction==='buy')
  console.log(`  ${allComplete.length.toLocaleString()} all complete  |  ${buys.length.toLocaleString()} buys`)

  // ── Filing lag from DB ────────────────────────────────────────────────────
  console.log('Fetching filing dates...')
  const filingLag=new Map<string,number>()  // id → lag days
  const allIds=rawRows.map(r=>r.id).filter(Boolean)
  let filedColFound=false
  try{
    // Try filed_at first
    for(let i=0;i<Math.min(allIds.length,50);i+=50){
      const{data,error}=await supabase.from('insider_transactions').select('id,filed_at').in('id',allIds.slice(i,i+50))
      if(error)throw error
      if(data&&(data[0] as any)?.filed_at!==undefined){filedColFound=true;break}
    }
  }catch{filedColFound=false}

  if(filedColFound){
    for(let i=0;i<allIds.length;i+=500){
      const{data}=await supabase.from('insider_transactions').select('id,filed_at,transaction_date').in('id',allIds.slice(i,i+500))
      for(const r of data??[]){
        const fa=(r as any).filed_at, td=(r as any).transaction_date
        if(fa&&td){const lag=daysBetween(td.split('T')[0],fa.split('T')[0]);if(lag>=0&&lag<365)filingLag.set((r as any).id,lag)}
      }
    }
    console.log(`  Filing lag: ${filingLag.size.toLocaleString()} rows`)
  } else {
    console.log('  filed_at column not found — F14 will be skipped')
  }

  // ── Per-ticker price history (for momentum F11, volatility F15) ───────────
  const tickerPH=new Map<string,{date:string;price:number}[]>()
  for(const r of rawRows){
    if(!r.ticker||r.price_entry==null)continue
    if(!tickerPH.has(r.ticker))tickerPH.set(r.ticker,[])
    tickerPH.get(r.ticker)!.push({date:r.transaction_date,price:r.price_entry})
  }
  for(const[tk,arr]of tickerPH){
    arr.sort((a,b)=>a.date<b.date?-1:1)
    const dd:typeof arr=[]
    for(const pt of arr){if(dd.length>0&&dd.at(-1)!.date===pt.date)dd.at(-1)!.price=pt.price;else dd.push(pt)}
    tickerPH.set(tk,dd)
  }

  // ── All purchases by ticker (cluster F03) ─────────────────────────────────
  const purchByTk=new Map<string,{date:string;cik:string}[]>()
  for(const r of rawRows){if(r.transaction_code!=='P'||!r.insider_cik)continue;if(!purchByTk.has(r.ticker))purchByTk.set(r.ticker,[]);purchByTk.get(r.ticker)!.push({date:r.transaction_date,cik:r.insider_cik})}
  for(const arr of purchByTk.values())arr.sort((a,b)=>a.date<b.date?-1:1)

  // ── All trades by ticker (breadth F13) ───────────────────────────────────
  const tradesByTk=new Map<string,{date:string;cik:string}[]>()
  for(const r of rawRows){if(!r.insider_cik)continue;if(!tradesByTk.has(r.ticker))tradesByTk.set(r.ticker,[]);tradesByTk.get(r.ticker)!.push({date:r.transaction_date,cik:r.insider_cik})}
  for(const arr of tradesByTk.values())arr.sort((a,b)=>a.date<b.date?-1:1)

  // ── All trades by insider (F06 LOO, F12 days-since) ──────────────────────
  const tradesByCik=new Map<string,{date:string;sm_alpha:number|null}[]>()
  for(const r of enriched){if(!r.insider_cik)continue;if(!tradesByCik.has(r.insider_cik))tradesByCik.set(r.insider_cik,[]);tradesByCik.get(r.insider_cik)!.push({date:r.transaction_date,sm_alpha:r.direction==='buy'?r.sm_alpha:null})}
  for(const arr of tradesByCik.values())arr.sort((a,b)=>a.date<b.date?-1:1)

  // All trade dates per insider (for F12)
  const datesByCik=new Map<string,string[]>()
  for(const r of rawRows){if(!r.insider_cik||!r.transaction_date)continue;if(!datesByCik.has(r.insider_cik))datesByCik.set(r.insider_cik,[]);datesByCik.get(r.insider_cik)!.push(r.transaction_date)}
  for(const[cik,arr]of datesByCik)datesByCik.set(cik,[...new Set(arr)].sort())

  // ─────────────────────────────────────────────────────────────────────────
  // TEMPORAL SWEEP — running means for F01 sector, F07 classification, F09 role
  // Process in date order; advance completed-trade pointer before reading
  // ─────────────────────────────────────────────────────────────────────────
  const sorted=[...buys].sort((a,b)=>a.transaction_date<b.transaction_date?-1:1)
  const byCompl=[...buys].filter(r=>r.sm_alpha!=null).sort((a,b)=>addD(a.transaction_date,180)<addD(b.transaction_date,180)?-1:1)

  const secSum=new Map<string,number>(),secCnt=new Map<string,number>()
  const rolSum=new Map<string,number>(),rolCnt=new Map<string,number>()
  const clsSum=new Map<string,number>(),clsCnt=new Map<string,number>()
  let cPtr=0

  // Factor arrays indexed by position in `sorted` (buys only)
  const N=sorted.length
  const F01=new Array<number|null>(N).fill(null)  // sector prior mean
  const F02=new Array<number|null>(N).fill(null)  // log pit mc
  const F03=new Array<number|null>(N).fill(null)  // cluster buy 30d
  const F04=new Array<number|null>(N).fill(null)  // stake increase log1p
  const F05=new Array<number|null>(N).fill(null)  // log abs shares
  const F06=new Array<number|null>(N).fill(null)  // LOO track record
  const F07=new Array<number|null>(N).fill(null)  // classification prior mean
  const F09=new Array<number|null>(N).fill(null)  // role prior mean
  const F10=new Array<number|null>(N).fill(null)  // log trade size
  const F11=new Array<number|null>(N).fill(null)  // momentum 90d
  const F12=new Array<number|null>(N).fill(null)  // days since last trade
  const F13=new Array<number|null>(N).fill(null)  // breadth 90d
  const F14=new Array<number|null>(N).fill(null)  // filing lag
  const F15=new Array<number|null>(N).fill(null)  // volatility 90d
  const FWD=new Array<number>(N)
  const CLSARR=sorted.map(r=>r.classification)

  // LOO track record: build per-cik buy lists sorted by date
  const looByInsider=new Map<string,{date:string;alpha:number;idx:number}[]>()
  for(let i=0;i<N;i++){const r=sorted[i];if(!r.insider_cik)continue;if(!looByInsider.has(r.insider_cik))looByInsider.set(r.insider_cik,[]);looByInsider.get(r.insider_cik)!.push({date:r.transaction_date,alpha:r.sm_alpha,idx:i})}
  const looResult=new Array<number|null>(N).fill(null)
  for(const trades of looByInsider.values()){
    for(let j=0;j<trades.length;j++){
      const T=trades[j].date,cut=addD(T,-180)
      const prior=trades.slice(0,j).filter(t=>t.date<cut).map(t=>t.alpha)
      if(prior.length>0)looResult[trades[j].idx]=prior.reduce((a,b)=>a+b,0)/prior.length
    }
  }

  console.log('Computing walk-forward factors...')
  for(let i=0;i<N;i++){
    const r=sorted[i],T=r.transaction_date

    // Advance completed pointer
    while(cPtr<byCompl.length&&addD(byCompl[cPtr].transaction_date,180)<T){
      const c=byCompl[cPtr]
      const sec=c.sector||'Unknown',rol=c.role_classified||'Other',cls=c.classification
      secSum.set(sec,(secSum.get(sec)??0)+c.sm_alpha);secCnt.set(sec,(secCnt.get(sec)??0)+1)
      rolSum.set(rol,(rolSum.get(rol)??0)+c.sm_alpha);rolCnt.set(rol,(rolCnt.get(rol)??0)+1)
      clsSum.set(cls,(clsSum.get(cls)??0)+c.sm_alpha);clsCnt.set(cls,(clsCnt.get(cls)??0)+1)
      cPtr++
    }

    FWD[i]=r.sm_alpha

    // F01 sector prior mean
    const sec=r.sector||'Unknown',sn=secCnt.get(sec)??0
    F01[i]=sn>=3?secSum.get(sec)!/sn:null

    // F02 log PIT mc
    F02[i]=r.log_pit_mc

    // F03 cluster buy 30d
    const win30=addD(T,-30),pkArr=purchByTk.get(r.ticker)??[]
    const clust=new Set<string>()
    for(const p of pkArr){if(p.date>=win30&&p.date<T&&p.cik!==r.insider_cik)clust.add(p.cik)}
    F03[i]=clust.size

    // F04 stake increase log1p
    if(r.shares!=null&&r.shares_owned_after!=null&&r.shares>0){
      const before=r.shares_owned_after-r.shares
      if(before>0)F04[i]=Math.log1p((r.shares/before)*100)
    }

    // F05 log abs shares
    if(r.shares!=null&&r.shares>0)F05[i]=Math.log10(r.shares)

    // F06 LOO track record
    F06[i]=looResult[i]

    // F07 classification prior mean
    const cls=r.classification,cn=clsCnt.get(cls)??0
    F07[i]=cn>=3?clsSum.get(cls)!/cn:null

    // F09 role prior mean
    const rol=r.role_classified||'Other',rn=rolCnt.get(rol)??0
    F09[i]=rn>=3?rolSum.get(rol)!/rn:null

    // F10 log trade size
    if(r.total_value!=null&&r.total_value>0)F10[i]=Math.log10(r.total_value)

    // F11 price momentum 90d (from CSV price history)
    const ph=tickerPH.get(r.ticker)??[]
    if(ph.length>=2&&r.price_entry!=null){
      const tgt=addD(T,-90)
      let best:number|null=null,bestD=15
      for(const pt of ph){if(pt.date>=T)break;const d=Math.abs(daysBetween(pt.date,tgt));if(d<bestD){bestD=d;best=pt.price}}
      if(best!=null&&best>0)F11[i]=Math.round(((r.price_entry-best)/best)*10000)/100
    }

    // F12 days since last trade
    const dates=datesByCik.get(r.insider_cik)??[]
    let lastD:string|null=null
    for(const d of dates){if(d<T)lastD=d}
    if(lastD!=null)F12[i]=daysBetween(lastD,T)

    // F13 insider breadth 90d (any direction)
    const win90=addD(T,-90),tkArr=tradesByTk.get(r.ticker)??[]
    const breadth=new Set<string>()
    for(const t of tkArr){if(t.date>=win90&&t.date<T&&t.cik!==r.insider_cik)breadth.add(t.cik)}
    F13[i]=breadth.size

    // F14 filing lag
    if(filedColFound)F14[i]=filingLag.get(r.id)??null

    // F15 pre-trade volatility 90d (std of log returns between consecutive observations)
    if(ph.length>=3){
      const in90=ph.filter(p=>p.date>=addD(T,-90)&&p.date<T)
      if(in90.length>=3){
        const rets:number[]=[]
        for(let k=1;k<in90.length;k++){
          const dt=daysBetween(in90[k-1].date,in90[k].date)
          if(dt>0&&in90[k-1].price>0)rets.push(Math.log(in90[k].price/in90[k-1].price)/Math.sqrt(dt))
        }
        if(rets.length>=2){
          const mu=rets.reduce((a,b)=>a+b,0)/rets.length
          const variance=rets.reduce((a,b)=>a+(b-mu)**2,0)/(rets.length-1)
          F15[i]=Math.sqrt(variance*252)*100  // annualized vol %
        }
      }
    }
  }

  // ── Direction factor across ALL complete trades ───────────────────────────
  const allFWD=allComplete.map(r=>r.sm_alpha)
  const F08_all=allComplete.map(r=>r.direction==='buy'?1:-1)
  const ic_f08_raw=pearson(F08_all,allFWD)
  const ic_f08_spear=spearman(F08_all,allFWD)
  const n_f08=allComplete.length

  // ─────────────────────────────────────────────────────────────────────────
  // COMPUTE ICs — per factor on buys, plus per classification
  // ─────────────────────────────────────────────────────────────────────────
  const CLASSES=['OPPORTUNISTIC','UNCLASSIFIABLE','ROUTINE'] as const

  type FactorDef={label:string;arr:(number|null)[];note?:string}
  const FACTORS:FactorDef[]=[
    {label:'F01 Sector prior mean α',   arr:F01},
    {label:'F02 PIT cap log10',         arr:F02},
    {label:'F03 Cluster buy 30d',       arr:F03},
    {label:'F04 Stake increase log1p',  arr:F04},
    {label:'F05 log Shares (abs)',       arr:F05},
    {label:'F06 Track record LOO',      arr:F06},
    {label:'F07 Classification prior',  arr:F07},
    {label:'F09 Role prior mean α',     arr:F09},
    {label:'F10 log Trade size',        arr:F10},
    {label:'F11 Price momentum 90d',    arr:F11},
    {label:'F12 Days since last trade', arr:F12},
    {label:'F13 Insider breadth 90d',   arr:F13},
    {label:'F14 Filing lag (days)',      arr:F14,note:filedColFound?undefined:'no data'},
    {label:'F15 Pre-trade vol 90d',     arr:F15},
  ]

  type ICRow={label:string;raw:number|null;spear:number|null;n:number
    byClass:Record<string,number|null>;note?:string}
  const results:ICRow[]=[]

  for(const{label,arr,note}of FACTORS){
    const xs:number[]=[],ys:number[]=[],cls_idx:Record<string,{xs:number[];ys:number[]}>={OPPORTUNISTIC:{xs:[],ys:[]},UNCLASSIFIABLE:{xs:[],ys:[]},ROUTINE:{xs:[],ys:[]}}
    for(let i=0;i<N;i++){
      const v=arr[i];if(v==null||!isFinite(v))continue
      xs.push(v);ys.push(FWD[i])
      cls_idx[CLSARR[i]]?.xs.push(v)
      cls_idx[CLSARR[i]]?.ys.push(FWD[i])
    }
    const byClass:Record<string,number|null>={}
    for(const cls of CLASSES){const{xs:cx,ys:cy}=cls_idx[cls];byClass[cls]=cx.length>=10?pearson(cx,cy):null}
    results.push({label,raw:xs.length>=10?pearson(xs,ys):null,spear:xs.length>=10?spearman(xs,ys):null,n:xs.length,byClass,note})
  }
  // Add direction separately
  results.push({label:'F08 Direction (buy+sell)',raw:ic_f08_raw,spear:ic_f08_spear,n:n_f08,byClass:{OPPORTUNISTIC:null,UNCLASSIFIABLE:null,ROUTINE:null},note:'all trades'})

  // Sort by |raw IC| descending
  results.sort((a,b)=>{
    const ia=a.raw!=null&&!isNaN(a.raw)?Math.abs(a.raw):0
    const ib=b.raw!=null&&!isNaN(b.raw)?Math.abs(b.raw):0
    return ib-ia
  })

  // ─────────────────────────────────────────────────────────────────────────
  // PRINT
  // ─────────────────────────────────────────────────────────────────────────
  function fic(v:number|null):string{
    if(v==null||isNaN(v))return '   N/A  '
    return ((v>=0?'+':'')+v.toFixed(4)).padStart(8)
  }
  function verdict(raw:number|null):string{
    if(raw==null||isNaN(raw))return '? no data'
    const a=Math.abs(raw)
    if(a>0.10)return '★ STRONG   >0.10'
    if(a>0.03)return '✓ moderate 0.03–0.10'
    return               '· noise    <0.03'
  }

  const SEP='─'.repeat(128)
  console.log('\n'+'█'.repeat(128))
  console.log('  WALK-FORWARD IC SCAN — 15 FACTORS vs FORWARD SIZE-MATCHED ALPHA 180d')
  console.log('  Every factor uses ONLY pre-trade information. Buys only (F08 = all trades).')
  console.log('  Sorted by |Pearson IC|.')
  console.log('█'.repeat(128))
  console.log('\n  '+
    'Factor'.padEnd(30)+
    'Raw IC'.padStart(9)+'  '+
    'Rank IC'.padStart(9)+'  '+
    'n'.padStart(7)+'  '+
    'OPP'.padStart(8)+'  '+
    'UNCL'.padStart(8)+'  '+
    'ROUT'.padStart(8)+'  '+
    'Verdict'
  )
  console.log('  '+SEP)

  for(const r of results){
    const note=r.note?` [${r.note}]`:''
    console.log(
      '  '+r.label.slice(0,29).padEnd(30)+
      fic(r.raw)+'  '+
      fic(r.spear)+'  '+
      String(r.n).padStart(7)+'  '+
      fic(r.byClass['OPPORTUNISTIC'])+'  '+
      fic(r.byClass['UNCLASSIFIABLE'])+'  '+
      fic(r.byClass['ROUTINE'])+'  '+
      verdict(r.raw)+note
    )
  }

  // ── Summary verdict ───────────────────────────────────────────────────────
  console.log('\n'+SEP)
  const strong=results.filter(r=>r.raw!=null&&!isNaN(r.raw)&&Math.abs(r.raw)>0.10)
  const moderate=results.filter(r=>r.raw!=null&&!isNaN(r.raw)&&Math.abs(r.raw)>0.03&&Math.abs(r.raw)<=0.10)
  const noise=results.filter(r=>r.raw==null||isNaN(r.raw)||Math.abs(r.raw)<=0.03)
  console.log(`\n  ★ STRONG  (|IC|>0.10): ${strong.map(r=>r.label).join('  |  ')||'none'}`)
  console.log(`  ✓ MODERATE(0.03–0.10): ${moderate.map(r=>r.label).join('  |  ')||'none'}`)
  console.log(`  · NOISE   (|IC|<0.03): ${noise.map(r=>r.label).join('  |  ')||'none'}`)
  console.log()
}

main().catch(err=>{console.error('Fatal:',err);process.exit(1)})
