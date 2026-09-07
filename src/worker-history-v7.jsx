import React,{useEffect,useMemo,useState} from 'react'
import {supabase} from './supabase'
import {Worker as BaseWorker} from './worker-v5'
import {Nav,Badge,Empty,day,money,hours} from './common-v2'

const ruDate=v=>v?new Date(`${String(v).slice(0,10)}T00:00:00`).toLocaleDateString('ru-RU'):'—'
const monthName=v=>v?new Date(`${String(v).slice(0,10)}T00:00:00`).toLocaleDateString('ru-RU',{month:'long',year:'numeric'}):'—'
const pct=v=>v===null||v===undefined?'—':`${Number(v).toFixed(1)}%`

export function Worker({profile}){
  const [open,setOpen]=useState(false)
  return <>
    <BaseWorker profile={profile}/>
    <button onClick={()=>setOpen(true)} style={{position:'fixed',right:16,bottom:16,zIndex:7000,borderRadius:999,padding:'12px 18px',boxShadow:'0 8px 24px rgba(0,0,0,.2)'}}>История</button>
    {open&&<WorkerHistory onClose={()=>setOpen(false)}/>} 
  </>
}

function WorkerHistory({onClose}){
  const [tab,setTab]=useState('reports')
  return <div className="modal"><div className="modal-card wide"><div className="row between"><div><h2>История</h2><div className="muted">Ваши отчёты, коэффициенты, зарплата и авансы</div></div><button className="ghost" onClick={onClose}>Закрыть</button></div><Nav items={[["reports","Отчёты"],["coef","Коэффициенты"],["salary","Зарплата"],["advances","Авансы"]]} value={tab} onChange={setTab}/>{tab==='reports'&&<ReportHistory/>}{tab==='coef'&&<CoefficientHistory/>}{tab==='salary'&&<SalaryHistory/>}{tab==='advances'&&<AdvanceHistory/>}</div></div>
}

function useReportHistory(){
  const [rows,setRows]=useState([]),[err,setErr]=useState(''),[loading,setLoading]=useState(true)
  async function load(){setLoading(true);const to=day(),from=`${Number(to.slice(0,4))-2}${to.slice(4)}`;const {data,error}=await supabase.rpc('get_worker_report_history_v7',{p_from:from,p_to:to});setLoading(false);if(error){setErr(error.message);setRows([])}else{setErr('');setRows(data||[])}}
  useEffect(()=>{load()},[])
  return {rows,err,loading}
}

function ReportHistory(){
  const {rows,err,loading}=useReportHistory(),[selected,setSelected]=useState(null)
  if(loading)return <Empty>Загрузка истории…</Empty>
  if(err)return <div className="warning">{err}</div>
  return <section><h3>История отчётов</h3><div className="cards">{rows.length?rows.map(r=><div className="card" key={r.report_id}><div className="row between"><b>{ruDate(r.report_date)}</b><Badge tone={r.status==='reviewed'?'green':'orange'}>{r.status==='reviewed'?'Проверен НЦ':'Ожидает проверки'}</Badge></div><div>Рабочее время: <b>{hours(r.worked_minutes)}</b></div>{r.status==='reviewed'&&<><div>ТБ: <b>{pct(r.safety_percent)}</b> · Выработка: <b>{pct(r.productivity_percent)}</b></div><div>Итого коэффициент: <b>{pct(r.total_percent)}</b></div><div>Начислено за день: <b>{money(r.day_pay)}</b></div></>}<button className="secondary" onClick={()=>setSelected(r)}>Открыть отчёт</button></div>):<Empty>Сохранённых отчётов пока нет</Empty>}</div>{selected&&<ReportDetails row={selected} onClose={()=>setSelected(null)}/>}</section>
}

function ReportDetails({row,onClose}){
  const items=Array.isArray(row.items)?row.items:[]
  return <div className="modal"><div className="modal-card wide"><div className="row between"><h3>Отчёт · {ruDate(row.report_date)}</h3><button className="ghost" onClick={onClose}>Закрыть</button></div><div className="cards"><div className="card"><span className="muted">ТБ</span><div className="kpi">{pct(row.safety_percent)}</div></div><div className="card"><span className="muted">Выработка</span><div className="kpi">{pct(row.productivity_percent)}</div></div><div className="card"><span className="muted">Общий %</span><div className="kpi">{pct(row.total_percent)}</div></div><div className="card"><span className="muted">Начислено</span><div className="kpi">{money(row.day_pay)}</div></div></div>{items.length?items.map((i,n)=><div className="report" key={i.id||n}><b>{i.title||'Работа'}</b><div>{i.minutes||0} мин {i.order_number&&`· заказ ${i.order_number}${i.position_number?` / ${i.position_number}`:''}`}</div>{i.worker_comment&&<div className="muted">Комментарий: {i.worker_comment}</div>}</div>):<Empty>В отчёте нет записей</Empty>}{row.worker_general_comment&&<div className="panel"><b>Ваш комментарий:</b> {row.worker_general_comment}</div>}{row.manager_comment&&<div className="panel"><b>Комментарий НЦ:</b> {row.manager_comment}</div>}{Number(row.penalty_amount||0)>0&&<div className="warning">Штраф / корректировка: {money(row.penalty_amount)}</div>}</div></div>
}

function CoefficientHistory(){
  const {rows,err,loading}=useReportHistory()
  const reviewed=rows.filter(x=>x.status==='reviewed')
  if(loading)return <Empty>Загрузка…</Empty>
  if(err)return <div className="warning">{err}</div>
  return <section><h3>Коэффициенты по дням</h3><div className="table"><table><thead><tr><th>Дата</th><th>ТБ</th><th>Выработка</th><th>Итого</th><th>Начислено</th></tr></thead><tbody>{reviewed.map(r=><tr key={r.report_id}><td>{ruDate(r.report_date)}</td><td>{pct(r.safety_percent)}</td><td>{pct(r.productivity_percent)}</td><td><b>{pct(r.total_percent)}</b></td><td>{money(r.day_pay)}</td></tr>)}</tbody></table></div>{!reviewed.length&&<Empty>Проверенных отчётов пока нет</Empty>}</section>
}

function SalaryHistory(){
  const [rows,setRows]=useState([]),[err,setErr]=useState(''),[loading,setLoading]=useState(true)
  useEffect(()=>{supabase.rpc('get_worker_salary_history_v7',{p_months:24}).then(({data,error})=>{setLoading(false);if(error)setErr(error.message);else setRows(data||[])})},[])
  const current=rows[0]
  if(loading)return <Empty>Загрузка зарплаты…</Empty>
  if(err)return <div className="warning">{err}</div>
  return <section><h3>История зарплаты</h3>{current&&<div className="cards"><div className="card"><span className="muted">Начислено в этом месяце</span><div className="kpi">{money(current.total_pay)}</div></div><div className="card"><span className="muted">Авансы в этом месяце</span><div className="kpi">{money(current.advances)}</div></div><div className="card"><span className="muted">Остаток</span><div className="kpi">{money(current.balance_to_pay)}</div></div><div className="card"><span className="muted">Средний % за месяц</span><div className="kpi">{pct(current.avg_total_percent)}</div></div></div>}<div className="table"><table><thead><tr><th>Месяц</th><th>Часы</th><th>Средний %</th><th>Начислено</th><th>Авансы</th><th>Остаток</th></tr></thead><tbody>{rows.map(r=><tr key={r.month_start}><td>{monthName(r.month_start)}</td><td>{hours(r.worked_minutes)}</td><td>{pct(r.avg_total_percent)}</td><td>{money(r.total_pay)}</td><td>{money(r.advances)}</td><td><b>{money(r.balance_to_pay)}</b></td></tr>)}</tbody></table></div>{!rows.length&&<Empty>Истории зарплаты пока нет</Empty>}</section>
}

function AdvanceHistory(){
  const [rows,setRows]=useState([]),[err,setErr]=useState(''),[loading,setLoading]=useState(true)
  useEffect(()=>{supabase.rpc('get_worker_advances_v7',{p_limit:200}).then(({data,error})=>{setLoading(false);if(error)setErr(error.message);else setRows(data||[])})},[])
  const total=useMemo(()=>rows.reduce((s,x)=>s+Number(x.amount||0),0),[rows])
  if(loading)return <Empty>Загрузка авансов…</Empty>
  if(err)return <div className="warning">{err}</div>
  return <section><div className="row between"><h3>Мои авансы</h3><b>Всего: {money(total)}</b></div>{rows.length?<div className="table"><table><thead><tr><th>Дата</th><th>Сумма</th><th>Комментарий</th></tr></thead><tbody>{rows.map(x=><tr key={x.id}><td>{ruDate(x.paid_at)}</td><td><b>{money(x.amount)}</b></td><td>{x.comment||'—'}</td></tr>)}</tbody></table></div>:<Empty>Авансов пока нет</Empty>}</section>
}
