import React,{useEffect,useMemo,useState} from 'react'
import {supabase} from './supabase'
import {monthStart,day,money,hours,Empty} from './common-v2'
export {Reports,Planning,Downtime} from './manager-reports-v4'
export {Labor} from './manager-labor-v8'

const pct=v=>v===null||v===undefined?'—':`${Number(v).toFixed(1)}%`
const ruDate=v=>v?new Date(`${String(v).slice(0,10)}T00:00:00`).toLocaleDateString('ru-RU'):'—'

export function Payroll(){
  const [from,setFrom]=useState(monthStart()),[to,setTo]=useState(day()),[rows,setRows]=useState([]),[err,setErr]=useState(''),[selected,setSelected]=useState(null)

  async function load(){
    setErr('')
    const {data,error}=await supabase.rpc('get_manager_payroll_summary_v5',{p_from:from,p_to:to})
    if(error){setErr(error.message);setRows([]);return}
    setRows(data||[])
  }

  useEffect(()=>{load()},[])

  const fot=rows.reduce((s,x)=>s+Number(x.calculated_pay||0),0)
  const advances=rows.reduce((s,x)=>s+Number(x.advances||0),0)
  const balance=rows.reduce((s,x)=>s+Number(x.balance_to_pay||0),0)

  async function addAdvance(worker){
    const raw=prompt(`Аванс для ${worker.full_name}, ₽:`)
    if(raw===null)return
    const amount=Number(String(raw).replace(',','.'))
    if(!amount||amount<=0)return alert('Введите сумму аванса больше 0')
    const paidAt=prompt('Дата аванса (ГГГГ-ММ-ДД):',day())||day()
    const comment=prompt('Комментарий к авансу:','')||''
    const {data:{user}}=await supabase.auth.getUser()
    const {error}=await supabase.from('payroll_advances').insert({worker_id:worker.worker_id,paid_at:paidAt,amount,comment,created_by:user?.id})
    if(error)alert(error.message);else load()
  }

  return <section>
    <div className="head"><div><h2>Зарплата и ФОТ</h2><div className="muted">ФОТ, авансы и остаток к выплате за выбранный период</div></div><div className="row"><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/><input type="date" value={to} onChange={e=>setTo(e.target.value)}/><button onClick={load}>Рассчитать</button></div></div>
    {err&&<div className="warning">{err}</div>}
    <div className="cards">
      <div className="card"><span className="muted">Общий ФОТ</span><div className="kpi">{money(fot)}</div></div>
      <div className="card"><span className="muted">Выдано авансами</span><div className="kpi">{money(advances)}</div></div>
      <div className="card"><span className="muted">Остаток к выплате</span><div className="kpi">{money(balance)}</div></div>
    </div>
    <div className="table"><table><thead><tr><th>Рабочий</th><th>Статус</th><th>Часы</th><th>Проверено смен</th><th>ТБ</th><th>Выработка</th><th>Штрафы</th><th>Начислено</th><th>Авансы</th><th>Остаток</th><th></th></tr></thead><tbody>{rows.map(x=><tr key={x.worker_id}><td><b>{x.full_name}</b></td><td>{x.active?'Работает':'Архив'}</td><td>{hours(x.worked_minutes)}</td><td>{x.reviewed_shifts}</td><td>{pct(x.avg_safety_percent)}</td><td>{pct(x.avg_productivity_percent)}</td><td>{money(x.penalties)}</td><td><b>{money(x.calculated_pay)}</b></td><td>{money(x.advances)}</td><td><b>{money(x.balance_to_pay)}</b></td><td><div className="row"><button className="secondary" onClick={()=>setSelected(x)}>Подробнее</button><button className="secondary" onClick={()=>addAdvance(x)}>+ Аванс</button></div></td></tr>)}</tbody></table></div>
    {selected&&<WorkerPayrollDetails worker={selected} from={from} to={to} onClose={()=>setSelected(null)} onChanged={load}/>} 
  </section>
}

function WorkerPayrollDetails({worker,from,to,onClose,onChanged}){
  const [daily,setDaily]=useState([]),[moves,setMoves]=useState([]),[rate,setRate]=useState(0),[loading,setLoading]=useState(true),[err,setErr]=useState('')

  async function load(){
    setLoading(true);setErr('')
    try{
      const [att,rep,rev,adv,pay,prof]=await Promise.all([
        supabase.from('attendance_days').select('work_date,worked_minutes').eq('worker_id',worker.worker_id).gte('work_date',from).lte('work_date',to).order('work_date'),
        supabase.from('daily_reports').select('id,report_date,status').eq('worker_id',worker.worker_id).gte('report_date',from).lte('report_date',to),
        supabase.from('report_reviews').select('report_id,safety_percent,productivity_percent,penalty_amount,penalty_reason').order('created_at'),
        supabase.from('payroll_advances').select('id,paid_at,amount,comment').eq('worker_id',worker.worker_id).gte('paid_at',from).lte('paid_at',to).order('paid_at'),
        supabase.from('payroll_payments').select('id,paid_at,amount,comment').eq('worker_id',worker.worker_id).gte('paid_at',from).lte('paid_at',to).order('paid_at'),
        supabase.from('profiles').select('rate_8h').eq('id',worker.worker_id).single()
      ])
      const firstErr=[att,rep,rev,adv,pay,prof].find(x=>x.error&&x.error.code!=='42P01')?.error
      if(firstErr){setErr(firstErr.message);setDaily([]);setMoves([]);return}
      const reports=rep.data||[],reviews=rev.data||[],byReport=Object.fromEntries(reports.map(r=>[r.id,r]))
      const revMap=Object.fromEntries(reviews.filter(x=>byReport[x.report_id]).map(x=>[x.report_id,x]))
      const reportByDate=Object.fromEntries(reports.map(r=>[r.report_date,r]))
      const r8=Number(prof.data?.rate_8h||0);setRate(r8)
      setDaily((att.data||[]).map(a=>{const rp=reportByDate[a.work_date],rv=rp?revMap[rp.id]:null,mins=Number(a.worked_minutes||0),s=rv?.safety_percent,p=rv?.productivity_percent,pen=Number(rv?.penalty_amount||0),base=mins*r8/480,total=(s===null||s===undefined||p===null||p===undefined)?null:base*(1+Number(s)/100+Number(p)/100)-pen;return {date:a.work_date,mins,s,p,totalPct:(s===null||s===undefined||p===null||p===undefined)?null:Number(s)+Number(p),pen,penReason:rv?.penalty_reason||'',total}}))
      const paymentRows=[...(adv.data||[]).map(x=>({...x,type:'Аванс'})),...(pay.data||[]).map(x=>({...x,type:'Зарплата'}))].sort((a,b)=>String(a.paid_at).localeCompare(String(b.paid_at)))
      setMoves(paymentRows)
    }catch(e){
      setErr(e?.message||'Не удалось загрузить подробности зарплаты')
      setDaily([]);setMoves([])
    }finally{
      setLoading(false)
    }
  }

  useEffect(()=>{load()},[worker.worker_id,from,to])

  async function addSalary(){
    const raw=prompt(`Выплата зарплаты для ${worker.full_name}, ₽:`)
    if(raw===null)return
    const amount=Number(String(raw).replace(',','.'))
    if(!amount||amount<=0)return alert('Введите сумму больше 0')
    const paidAt=prompt('Дата выплаты (ГГГГ-ММ-ДД):',day())||day()
    const comment=prompt('Комментарий:','')||''
    const {data:{user}}=await supabase.auth.getUser()
    const {error}=await supabase.from('payroll_payments').insert({worker_id:worker.worker_id,paid_at:paidAt,amount,comment,created_by:user?.id})
    if(error){alert(error.message);return}
    await load();onChanged?.()
  }

  if(loading)return <div className="modal"><div className="modal-card wide"><Empty>Загрузка подробностей…</Empty></div></div>
  return <div className="modal"><div className="modal-card wide"><div className="row between"><div><h2>{worker.full_name}</h2><div className="muted">Подробно за {ruDate(from)} — {ruDate(to)} · ставка {money(rate)} / 8 ч</div></div><button className="ghost" onClick={onClose}>Закрыть</button></div>{err&&<div className="warning">Не удалось загрузить часть данных: {err}</div>}
    <h3>По дням</h3>{daily.length?<div className="table"><table><thead><tr><th>Дата</th><th>Отработано</th><th>ТБ</th><th>Выработка</th><th>Общий %</th><th>Штраф</th><th>Начислено за день</th></tr></thead><tbody>{daily.map(x=><tr key={x.date}><td>{ruDate(x.date)}</td><td>{hours(x.mins)}</td><td>{pct(x.s)}</td><td>{pct(x.p)}</td><td><b>{pct(x.totalPct)}</b></td><td>{money(x.pen)}{x.penReason&&<div className="muted">{x.penReason}</div>}</td><td>{x.total===null?'Отчёт не проверен':<b>{money(x.total)}</b>}</td></tr>)}</tbody></table></div>:<Empty>За выбранный период данных по рабочим дням нет</Empty>}
    <div className="row between"><h3>Выплаты</h3><button onClick={addSalary}>+ Выплата зарплаты</button></div>{moves.length?<div className="table"><table><thead><tr><th>Дата</th><th>Тип</th><th>Сумма</th><th>Комментарий</th></tr></thead><tbody>{moves.map(x=><tr key={`${x.type}-${x.id}`}><td>{ruDate(x.paid_at)}</td><td>{x.type}</td><td><b>{money(x.amount)}</b></td><td>{x.comment||'—'}</td></tr>)}</tbody></table></div>:<Empty>В выбранном периоде выплат нет</Empty>}
  </div></div>
}
