import React,{useEffect,useMemo,useState} from 'react'
import {supabase} from './supabase'
import {Empty,day,hours,dt} from './common-v2'
export {Reports,Planning,Labor,Payroll} from './manager-reports-v2'

export const DOWNTIME_RU={
  no_task:'Нет задания',no_material:'Нет материала',no_components:'Нет комплектующих',no_drawing:'Нет чертежа',no_tool:'Нет инструмента',broken_tool:'Сломан инструмент',waiting_previous:'Ожидание предыдущей операции',waiting_previous_operation:'Ожидание предыдущей операции',manager_decision:'Решение НЦ',equipment_failure:'Поломка оборудования',other:'Другое',waiting_task:'Нет задания'
}

export function Downtime(){
  const [rows,setRows]=useState([]),[onlyToday,setOnlyToday]=useState(true)
  async function load(){
    let q=supabase.from('downtime_events').select('*,profiles!downtime_events_worker_id_fkey(full_name)').order('started_at',{ascending:false}).limit(500)
    if(onlyToday)q=q.gte('started_at',`${day()}T00:00:00+05:00`)
    const {data,error}=await q
    if(error)alert(error.message);else setRows(data||[])
  }
  useEffect(()=>{load()},[onlyToday])
  const summary=useMemo(()=>{const o={};for(const x of rows){const min=Math.max(0,Math.round(((x.ended_at?new Date(x.ended_at):new Date())-new Date(x.started_at))/60000));o[x.reason]=(o[x.reason]||0)+min}return Object.entries(o).sort((a,b)=>b[1]-a[1])},[rows])
  return <section><div className="head"><div><h2>Простои</h2><div className="muted">Время простоя считается только внутри открытой смены.</div></div><label className="checkline"><input type="checkbox" checked={onlyToday} onChange={e=>setOnlyToday(e.target.checked)}/> Только сегодня</label></div>
    {summary.length?<div className="cards">{summary.map(([k,v])=><div className="card" key={k}><b>{DOWNTIME_RU[k]||'Другое'}</b><div className="kpi">{hours(v)}</div></div>)}</div>:<Empty>Простоев нет</Empty>}
    <div className="table"><table><thead><tr><th>Рабочий</th><th>Причина</th><th>Начало</th><th>Конец</th><th>Комментарий</th></tr></thead><tbody>{rows.map(x=><tr key={x.id}><td>{x.profiles?.full_name||'—'}</td><td>{DOWNTIME_RU[x.reason]||'Другое'}</td><td>{dt(x.started_at)}</td><td>{x.ended_at?dt(x.ended_at):'Сейчас'}</td><td>{x.comment||'—'}</td></tr>)}</tbody></table></div>
  </section>
}
