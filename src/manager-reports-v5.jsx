import React,{useEffect,useState} from 'react'
import {supabase} from './supabase'
import {monthStart,day,money,hours} from './common-v2'
export {Reports,Planning,Labor,Downtime} from './manager-reports-v4'

export function Payroll(){
  const [from,setFrom]=useState(monthStart()),[to,setTo]=useState(day()),[rows,setRows]=useState([]),[err,setErr]=useState('')

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
    <div className="table"><table><thead><tr><th>Рабочий</th><th>Статус</th><th>Часы</th><th>Проверено смен</th><th>ТБ</th><th>Выработка</th><th>Штрафы</th><th>Начислено</th><th>Авансы</th><th>Остаток</th><th></th></tr></thead><tbody>{rows.map(x=><tr key={x.worker_id}><td><b>{x.full_name}</b></td><td>{x.active?'Работает':'Архив'}</td><td>{hours(x.worked_minutes)}</td><td>{x.reviewed_shifts}</td><td>{Number(x.avg_safety_percent||0).toFixed(1)}%</td><td>{Number(x.avg_productivity_percent||0).toFixed(1)}%</td><td>{money(x.penalties)}</td><td><b>{money(x.calculated_pay)}</b></td><td>{money(x.advances)}</td><td><b>{money(x.balance_to_pay)}</b></td><td><button className="secondary" onClick={()=>addAdvance(x)}>+ Аванс</button></td></tr>)}</tbody></table></div>
  </section>
}
