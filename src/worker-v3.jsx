import React,{useEffect,useState} from 'react'
import {supabase} from './supabase'
import {Header,Nav,Badge,Field,Empty,Timer,STATUS,REASONS,day,monthStart,money,hours,useLive,compress} from './common-v2'

export function Worker({profile}){
  const [tab,setTab]=useState('today')
  const openReport=()=>{localStorage.setItem(`ferrum-end-shift-${day()}`,'1');setTab('report')}
  return <><Header profile={profile} title="Рабочее место"/><main className="worker">
    <Nav items={[["today","Сегодня"],["report","Отчёт"],["pay","Зарплата"],["notifications","Уведомления"]]} value={tab} onChange={setTab}/>
    {tab==='today'&&<Today profile={profile} goReport={openReport}/>} 
    {tab==='report'&&<Report profile={profile}/>} 
    {tab==='pay'&&<Pay/>}
    {tab==='notifications'&&<Notifications profile={profile}/>} 
  </main></>
}

function Today({profile,goReport}){
  const [tasks,setTasks]=useState([]),[uploaded,setUploaded]=useState({}),[shiftStarted,setShiftStarted]=useState(false),[reportSent,setReportSent]=useState(false),[completedToday,setCompletedToday]=useState(0),[checking,setChecking]=useState(true)
  const shiftKey=`ferrum-shift-${profile.id}-${day()}`
  async function load(){
    const d=day(),start=`${d}T00:00:00+05:00`
    const [taskRes,attRes,doneRes]=await Promise.all([
      supabase.from('tasks').select('*').eq('assigned_to',profile.id).in('status',['queued','active','stop_requested']).order('priority',{ascending:false}).order('queue_order'),
      supabase.from('attendance_days').select('first_login_at,report_submitted_at').eq('worker_id',profile.id).eq('work_date',d).maybeSingle(),
      supabase.from('tasks').select('id',{count:'exact',head:true}).eq('assigned_to',profile.id).in('status',['completed','blocked_closed','closed_by_manager']).gte('completed_at',start)
    ])
    setTasks(taskRes.data||[])
    const serverStarted=Boolean(attRes.data?.first_login_at),localStarted=localStorage.getItem(shiftKey)==='1'
    if(serverStarted)localStorage.setItem(shiftKey,'1')
    setShiftStarted(serverStarted||localStarted)
    setReportSent(Boolean(attRes.data?.report_submitted_at))
    setCompletedToday(doneRes.count||0)
    setChecking(false)
  }
  useEffect(()=>{load()},[])
  useLive('tasks',load,`assigned_to=eq.${profile.id}`)
  const active=tasks.find(x=>['active','stop_requested'].includes(x.status)),queue=tasks.filter(x=>x.status==='queued')
  async function beginShift(){
    const {error}=await supabase.rpc('clock_in',{p_user_agent:navigator.userAgent,p_client_label:'worker-web'})
    if(error)return alert(error.message)
    localStorage.setItem(shiftKey,'1');setShiftStarted(true);load()
  }
  async function start(id){const {error}=await supabase.rpc('start_task',{p_task_id:id});if(error)alert(error.message);else load()}
  async function stop(id){const reason=prompt('Причина: '+REASONS.map(x=>x[0]).join(', '),'no_material');if(!reason)return;const comment=prompt('Комментарий:','')||'';const {error}=await supabase.rpc('request_task_stop',{p_task_id:id,p_reason:reason,p_comment:comment});if(error)alert(error.message);else load()}
  async function upload(task,file,kind){if(!file)return;try{const f=await compress(file),path=`${profile.id}/${task.id}/${Date.now()}-${kind}.jpg`;const up=await supabase.storage.from('task-photos').upload(path,f,{contentType:'image/jpeg'});if(up.error)return alert(up.error.message);const ins=await supabase.from('task_photos').insert({task_id:task.id,worker_id:profile.id,kind,object_path:path,storage_path:path});if(ins.error)alert(ins.error.message);else setUploaded(v=>({...v,[`${task.id}-${kind}`]:true}))}catch(e){alert(e?.message||'Не удалось обработать фото')}}
  async function done(id){const {error}=await supabase.rpc('complete_task',{p_task_id:id});if(error)alert(error.message);else load()}
  if(checking)return <Empty>Загрузка смены…</Empty>
  return <section>
    <div className="head"><div><h2>Сегодня</h2><div className="muted">{day()}</div></div>{shiftStarted&&!reportSent?<Badge tone="green">Смена начата</Badge>:reportSent?<Badge tone="blue">Смена завершена</Badge>:<Badge>Смена не начата</Badge>}</div>

    {!shiftStarted&&!reportSent&&<div className="panel shift-start"><h2>Начало смены</h2><p>Нажмите кнопку, когда приступаете к работе. С этого момента начнётся учёт смены.</p><button className="big-action" onClick={beginShift}>Начать смену</button></div>}

    {reportSent&&<div className="panel"><h3>Смена завершена</h3><div>Ежедневный отчёт отправлен. Новую смену сегодня начинать не нужно.</div></div>}

    {shiftStarted&&!reportSent&&<><h2>Текущее задание</h2>
      {active?<div className="task active"><div className="row between"><Badge tone={active.status==='active'?'green':active.close_approved_at?'blue':'orange'}>{active.close_approved_at?'НЦ разрешил закрыть':STATUS[active.status]}</Badge><Timer startedAt={active.started_at}/></div><h2>{active.title}</h2><div className="order">Заказ {active.order_number} · позиция {active.position_number}</div><p>{active.description}</p><div>План: <b>{active.planned_minutes} мин</b></div>
        {active.status==='active'&&<><div className="split"><Field label="Фото до (необязательно)"><input type="file" accept="image/*" capture="environment" onChange={e=>upload(active,e.target.files?.[0],'before')}/>{uploaded[`${active.id}-before`]&&<small>Сохранено ✓</small>}</Field><Field label="Фото после (обязательно)"><input type="file" accept="image/*" capture="environment" onChange={e=>upload(active,e.target.files?.[0],'after')}/>{uploaded[`${active.id}-after`]&&<small>Сохранено ✓</small>}</Field></div><div className="row"><button className="secondary" onClick={()=>stop(active.id)}>Не могу продолжить</button><button onClick={()=>done(active.id)}>Завершить</button></div></>}
        {active.status==='stop_requested'&&!active.close_approved_at&&<div className="warning">Запрос отправлен НЦ. Ожидайте решения.</div>}
        {active.close_approved_at&&<><div className="warning">НЦ разрешил закрыть задание. Фото после не обязательно.</div><button onClick={()=>done(active.id)}>Закрыть задание</button></>}
      </div>:<div className="panel">Активного задания нет.</div>}

      <h2>Очередь</h2>
      {queue.length?queue.map((x,i)=><div className="task" key={x.id}><div className="row between"><b>#{i+1} · {x.title}</b><Badge tone={x.priority==='urgent'?'red':x.priority==='high'?'orange':'gray'}>{x.priority==='urgent'?'Срочно':x.priority==='high'?'Высокий':'Обычный'}</Badge></div><div>Заказ {x.order_number} · поз. {x.position_number}</div><div className="muted">План {x.planned_minutes} мин</div>{!active&&i===0&&<button onClick={()=>start(x.id)}>Начать задание</button>}</div>):<Empty>Следующих заданий нет — подойдите к начальнику цеха</Empty>}

      {!active&&queue.length===0&&completedToday>0&&<div className="panel end-shift"><h2>Все задания закончены</h2><p><b>Подойдите к начальнику цеха.</b> Если новых заданий нет, завершите смену и заполните ежедневный отчёт.</p><button className="big-action" onClick={goReport}>Завершить смену и написать отчёт</button></div>}
    </>}
  </section>
}

function Report({profile}){
  const [report,setReport]=useState(null),[available,setAvailable]=useState(false),[early,setEarly]=useState(null),[u,setU]=useState({title:'',minutes:'',comment:''})
  const closing=localStorage.getItem(`ferrum-end-shift-${day()}`)==='1'
  async function load(){const d=day(),r=await supabase.rpc('get_or_build_daily_report',{p_date:d}),id=r.data,[rep,av,er]=await Promise.all([supabase.from('daily_reports').select('*,daily_report_items(*)').eq('id',id).single(),supabase.rpc('report_is_available',{p_worker_id:profile.id,p_date:d}),supabase.from('early_report_requests').select('*').eq('worker_id',profile.id).eq('work_date',d).maybeSingle()]);setReport(rep.data);setAvailable(Boolean(av.data));setEarly(er.data)}
  useEffect(()=>{load()},[])
  async function comment(i,v){await supabase.from('daily_report_items').update({worker_comment:v}).eq('id',i.id);if(i.task_id)await supabase.from('report_task_comments').upsert({report_id:report.id,task_id:i.task_id,worker_comment:v},{onConflict:'report_id,task_id'})}
  async function add(){if(!u.title||!Number(u.minutes))return alert('Укажите работу и минуты');const {error}=await supabase.from('unplanned_work').insert({report_id:report.id,worker_id:profile.id,title:u.title,minutes:Number(u.minutes),comment:u.comment,status:'pending'});if(error)alert(error.message);else{setU({title:'',minutes:'',comment:''});load()}}
  async function earlyReq(){const reason=prompt('Почему нужно отправить отчёт раньше?');if(!reason)return;const {error}=await supabase.rpc('request_early_report',{p_reason:reason});if(error)alert(error.message);else{alert('Запрос отправлен начальнику цеха');load()}}
  async function submit(){const {error}=await supabase.rpc('submit_daily_report',{p_report_date:day(),p_general_comment:document.querySelector('#gc')?.value||''});if(error)alert(error.message);else{localStorage.removeItem(`ferrum-end-shift-${day()}`);alert('Смена завершена. Отчёт отправлен.');load()}}
  if(!report)return <Empty>Загрузка отчёта…</Empty>
  return <section><h2>{closing?'Завершение смены':'Отчёт'} · {report.report_date}</h2>
    {closing&&report.status==='draft'&&<div className="panel"><h3>Завершение смены</h3><div>Проверьте выполненные работы, добавьте комментарии и отправьте отчёт. После отправки смена будет считаться завершённой.</div>{!available&&<div className="warning">Сейчас отчёт ещё нельзя отправить по графику. Если работа закончена раньше, запросите у НЦ разрешение на раннее завершение смены.</div>}</div>}
    <div className="panel"><Badge tone={report.status==='reviewed'?'green':report.status==='submitted'?'blue':'gray'}>{report.status==='draft'?'Черновик':report.status==='submitted'?'Отправлен':'Проверен'}</Badge></div>
    {(report.daily_report_items||[]).map(i=><div className="report" key={i.id}><b>{i.title}</b><div>{i.minutes} мин {i.order_number&&`· заказ ${i.order_number}/${i.position_number}`}</div>{report.status==='draft'?<textarea defaultValue={i.worker_comment||''} placeholder="Комментарий" onBlur={e=>comment(i,e.target.value)}/>:<div className="muted">{i.worker_comment}</div>}</div>)}
    {report.status==='draft'&&<><div className="panel"><h3>Внеплановая работа</h3><div className="form"><Field label="Что делал"><input value={u.title} onChange={e=>setU({...u,title:e.target.value})}/></Field><Field label="Минут"><input type="number" min="1" value={u.minutes} onChange={e=>setU({...u,minutes:e.target.value})}/></Field><Field label="Комментарий" wide><input value={u.comment} onChange={e=>setU({...u,comment:e.target.value})}/></Field><button className="wide" onClick={add}>Добавить</button></div></div><Field label="Общий комментарий"><textarea id="gc" defaultValue={report.worker_general_comment||''}/></Field>{early&&<div className="panel">Раннее завершение: <b>{early.status==='pending'?'ожидает решения НЦ':early.status==='approved'?'разрешено':'отклонено'}</b></div>}<div className="row"><button className="secondary" onClick={earlyReq}>Запросить раннее завершение</button><button disabled={!available} onClick={submit}>Отправить отчёт и завершить смену</button></div></>}
  </section>
}

function Pay(){const [x,setX]=useState(null);useEffect(()=>{supabase.rpc('worker_payroll_summary',{p_from:monthStart(),p_to:day()}).then(({data})=>setX(data?.[0]))},[]);return <section><h2>Зарплата</h2><div className="cards"><div className="card"><span className="muted">Начислено</span><div className="kpi">{money(x?.total_pay)}</div></div><div className="card"><span className="muted">База</span><div className="kpi">{money(x?.base_pay)}</div></div><div className="card"><span className="muted">Проверено</span><div className="kpi">{hours(x?.worked_minutes)}</div></div><div className="card"><span className="muted">Средний ТБ</span><div className="kpi">{Number(x?.avg_safety||0).toFixed(1)}%</div></div></div><div className="panel">Коэффициент выработки учтён в итоговой сумме, но процент не отображается.</div></section>}

function Notifications({profile}){const [rows,setRows]=useState([]);async function load(){const {data}=await supabase.from('notifications').select('*').eq('user_id',profile.id).order('created_at',{ascending:false}).limit(100);setRows(data||[])}useEffect(()=>{load()},[]);useLive('notifications',load,`user_id=eq.${profile.id}`);async function read(id){await supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id);load()}return <section><h2>Уведомления</h2>{rows.length?rows.map(n=><div className={`card note ${n.read_at?'read':''}`} key={n.id} onClick={()=>read(n.id)}><div className="row between"><b>{n.title}</b>{!n.read_at&&<Badge tone="blue">Новое</Badge>}</div><div>{n.body}</div></div>):<Empty>Уведомлений нет</Empty>}</section>}
