import React,{useEffect,useMemo,useState} from 'react'
import {supabase} from './supabase'
import {Reports,Planning,Labor,Payroll} from './manager-reports-v2'
import {Field,day,dt,hours} from './common-v2'
export {Reports,Planning,Labor,Payroll}

const REASON_LABELS={
  no_task:'Нет задания',
  no_material:'Нет материала',
  no_components:'Нет комплектующих',
  no_drawing:'Нет чертежа',
  no_tool:'Нет инструмента',
  broken_tool:'Сломан инструмент',
  waiting_previous:'Ожидание предыдущей операции',
  manager_decision:'Решение начальника цеха',
  equipment_failure:'Поломка оборудования',
  other:'Другое'
}

export function Downtime(){
  const [rows,setRows]=useState([]),[worker,setWorker]=useState(''),[from,setFrom]=useState(day()),[to,setTo]=useState(day())
  async function load(){
    let q=supabase.from('downtime_events').select('*,profiles!downtime_events_worker_id_fkey(full_name)').gte('started_at',`${from}T00:00:00+05:00`).lte('started_at',`${to}T23:59:59+05:00`).order('started_at',{ascending:false}).limit(500)
    if(worker)q=q.eq('worker_id',worker)
    const {data,error}=await q;if(error)alert(error.message);else setRows(data||[])
  }
  useEffect(()=>{load()},[])
  const workers=useMemo(()=>{const m=new Map();for(const x of rows)if(x.worker_id)m.set(x.worker_id,x.profiles?.full_name||'Рабочий');return [...m.entries()]},[rows])
  const summary=useMemo(()=>{const o={};for(const x of rows){const end=x.ended_at?new Date(x.ended_at):new Date();const mins=Math.max(0,Math.round((end-new Date(x.started_at))/60000));o[x.reason]=(o[x.reason]||0)+mins}return Object.entries(o).sort((a,b)=>b[1]-a[1])},[rows])
  return <section><div className="head"><div><h2>Простои</h2><div className="muted">Учитываются только внутри открытой смены рабочего</div></div><button onClick={load}>Обновить</button></div>
    <div className="panel form"><Field label="С даты"><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></Field><Field label="По дату"><input type="date" value={to} onChange={e=>setTo(e.target.value)}/></Field><Field label="Рабочий"><select value={worker} onChange={e=>setWorker(e.target.value)}><option value="">Все рабочие</option>{workers.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></Field><button onClick={load}>Показать</button></div>
    <div className="cards">{summary.map(([k,v])=><div className="card" key={k}><b>{REASON_LABELS[k]||k}</b><div className="kpi">{hours(v)}</div></div>)}</div>
    <div className="table"><table><thead><tr><th>Рабочий</th><th>Причина</th><th>Начало</th><th>Конец</th><th>Длительность</th><th>Комментарий</th></tr></thead><tbody>{rows.map(x=>{const end=x.ended_at?new Date(x.ended_at):new Date(),mins=Math.max(0,Math.round((end-new Date(x.started_at))/60000));return <tr key={x.id}><td>{x.profiles?.full_name||'—'}</td><td>{REASON_LABELS[x.reason]||x.reason}</td><td>{dt(x.started_at)}</td><td>{x.ended_at?dt(x.ended_at):'Сейчас'}</td><td>{hours(mins)}</td><td>{x.comment||'—'}</td></tr>})}</tbody></table></div>
  </section>
}
