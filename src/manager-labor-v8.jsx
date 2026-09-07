import React,{useEffect,useState} from 'react'
import * as XLSX from 'xlsx'
import {supabase} from './supabase'
import {Field,day} from './common-v2'

export function Labor(){
  const [rows,setRows]=useState([]),[q,setQ]=useState('')
  useEffect(()=>{
    supabase.from('tasks')
      .select('order_number,position_number,title,planned_minutes,actual_minutes,completed_at,profiles!tasks_assigned_to_fkey(full_name)')
      .in('status',['completed','blocked_closed','closed_by_manager'])
      .order('completed_at',{ascending:false})
      .then(({data})=>setRows(data||[]))
  },[])
  const a=rows.filter(x=>!q||String(x.order_number).includes(q))
  function xlsx(){
    const ws=XLSX.utils.json_to_sheet(a.map(x=>({
      'Заказ':x.order_number,
      'Позиция':x.position_number,
      'Рабочий':x.profiles?.full_name,
      'Операция':x.title,
      'План, мин':x.planned_minutes,
      'Факт, мин':x.actual_minutes,
      'Отклонение, мин':Number(x.actual_minutes||0)-Number(x.planned_minutes||0),
      'Дата':x.completed_at
    })))
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Трудозатраты');XLSX.writeFile(wb,`FERRUM_trudozatraty_${day()}.xlsx`)
  }
  return <section><div className="head"><h2>Трудозатраты</h2><button onClick={xlsx}>Экспорт Excel</button></div><Field label="Фильтр по заказу"><input value={q} onChange={e=>setQ(e.target.value)}/></Field><div className="table"><table><thead><tr><th>Заказ</th><th>Позиция</th><th>Рабочий</th><th>Операция</th><th>План</th><th>Факт</th><th>Отклонение</th></tr></thead><tbody>{a.map((x,i)=>{const d=Number(x.actual_minutes||0)-Number(x.planned_minutes||0);return <tr key={i}><td>{x.order_number}</td><td>{x.position_number}</td><td>{x.profiles?.full_name}</td><td>{x.title}</td><td><b>{x.planned_minutes||0} мин</b></td><td>{x.actual_minutes||0} мин</td><td>{d>0?`+${d}`:d} мин</td></tr>})}</tbody></table></div></section>
}
