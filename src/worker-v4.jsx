import React,{useEffect,useState} from 'react'
import {supabase} from './supabase'
import {Header,Nav,Badge,Field,Empty,Timer,STATUS,REASONS,day,monthStart,money,hours,useLive,compress,dt} from './common-v2'

export function Worker({profile}){
  const [tab,setTab]=useState('today')
  return <><Header profile={profile} title="Рабочее место"/><main className="worker">
    <Nav items={[["today","Сегодня"],["report","Отчёт"],["pay","Зарплата"],["help","Инструкция"],["notifications","Уведомления"]]} value={tab} onChange={setTab}/>
    {tab==='today'&&<Today profile={profile} goReport={()=>setTab('report')}/>} 
    {tab==='report'&&<Report profile={profile}/>} 
    {tab==='pay'&&<Pay/>}
    {tab==='help'&&<WorkerHelp/>}
    {tab==='notifications'&&<Notifications profile={profile}/>} 
  </main></>
}

function Today({profile,goReport}){
  const [tasks,setTasks]=useState([]),[uploaded,setUploaded]=useState({}),[shift,setShift]=useState(null),[lastShift,setLastShift]=useState(null),[reportSent,setReportSent]=useState(false),[available,setAvailable]=useState(false),[early,setEarly]=useState(null),[reopen,setReopen]=useState(null),[completedToday,setCompletedToday]=useState(0),[loading,setLoading]=useState(true)
  async function load(){
    const d=day(),start=`${d}T00:00:00+05:00`
    const [taskRes,shiftRes,attRes,avRes,earlyRes,reopenRes,doneRes]=await Promise.all([
      supabase.from('tasks').select('*').eq('assigned_to',profile.id).in('status',['queued','active','stop_requested']).order('priority',{ascending:false}).order('queue_order'),
      supabase.from('shift_sessions').select('*').eq('worker_id',profile.id).eq('work_date',d).order('sequence_no',{ascending:false}),
      supabase.from('attendance_days').select('report_submitted_at').eq('worker_id',profile.id).eq('work_date',d).maybeSingle(),
      supabase.rpc('report_is_available',{p_worker_id:profile.id,p_date:d}),
      supabase.from('early_report_requests').select('*').eq('worker_id',profile.id).eq('work_date',d).order('created_at',{ascending:false}).limit(1),
      supabase.from('shift_reopen_requests').select('*').eq('worker_id',profile.id).eq('work_date',d).order('created_at',{ascending:false}).limit(1),
      supabase.from('tasks').select('id',{count:'exact',head:true}).eq('assigned_to',profile.id).in('status',['completed','blocked_closed','closed_by_manager']).gte('completed_at',start)
    ])
    setTasks(taskRes.data||[])
    const shifts=shiftRes.data||[];setShift(shifts.find(x=>!x.ended_at)||null);setLastShift(shifts[0]||null)
    setReportSent(Boolean(attRes.data?.report_submitted_at));setAvailable(Boolean(avRes.data));setEarly(earlyRes.data?.[0]||null);setReopen(reopenRes.data?.[0]||null);setCompletedToday(doneRes.count||0);setLoading(false)
  }
  useEffect(()=>{load()},[]);useLive('tasks',load,`assigned_to=eq.${profile.id}`);useLive('notifications',load,`user_id=eq.${profile.id}`)
  const active=tasks.find(x=>['active','stop_requested'].includes(x.status)),queue=tasks.filter(x=>x.status==='queued')
  async function beginShift(){const {error}=await supabase.rpc('start_shift');if(error)alert(error.message);else load()}
  async function requestReopen(){const reason=prompt('Почему нужна повторная смена?');if(!reason)return;const {error}=await supabase.rpc('request_shift_reopen',{p_reason:reason});if(error)alert(error.message);else load()}
  async function requestEarly(){const reason=prompt('Почему нужно завершить смену раньше?');if(!reason)return;const {error}=await supabase.rpc('request_early_report',{p_reason:reason});if(error)alert(error.message);else load()}
  async function start(id){const {error}=await supabase.rpc('start_task',{p_task_id:id});if(error)alert(error.message);else load()}
  async function stop(id){const text=REASONS.map((x,i)=>`${i+1}. ${x[1]}`).join('\n'),raw=prompt(`Выберите причину и введите её номер:\n${text}`,'1');if(!raw)return;const item=REASONS[Number(raw)-1];if(!item)return alert('Неверный номер причины');const comment=prompt('Комментарий:','')||'';const {error}=await supabase.rpc('request_task_stop',{p_task_id:id,p_reason:item[0],p_comment:comment});if(error)alert(error.message);else load()}
  async function upload(task,file,kind){if(!file)return;try{let f=file;try{f=await compress(file)}catch{}const path=`${profile.id}/${task.id}/${Date.now()}-${kind}.jpg`;const up=await supabase.storage.from('task-photos').upload(path,f,{contentType:f.type||'image/jpeg'});if(up.error)return alert(up.error.message);const ins=await supabase.from('task_photos').insert({task_id:task.id,worker_id:profile.id,kind,object_path:path,storage_path:path});if(ins.error)alert(ins.error.message);else setUploaded(v=>({...v,[`${task.id}-${kind}`]:true}))}catch(e){alert(e?.message||'Не удалось сохранить фото')}}
  async function done(id){const {error}=await supabase.rpc('complete_task',{p_task_id:id});if(error)alert(error.message);else load()}
  if(loading)return <Empty>Загрузка смены…</Empty>

  if(!shift&&reportSent){
    return <section><h2>Сегодня</h2><div className="panel shift-ended"><div className="row between"><h3>Смена завершена</h3><Badge tone="gray">Не на рабочем месте</Badge></div><div>Завершено: {lastShift?.ended_at?dt(lastShift.ended_at):'сегодня'}</div></div>
      {reopen?.status==='pending'?<div className="panel"><b>Запрос на повторную смену отправлен НЦ.</b><div className="muted">Ожидайте решения.</div></div>:
       reopen?.status==='approved'?<div className="panel"><h3>Повторная смена разрешена</h3><button className="big-action" onClick={beginShift}>Начать повторную смену</button></div>:
       <div className="panel"><h3>Нужно снова выйти на работу?</h3>{reopen?.status==='rejected'&&<div className="warning">Предыдущий запрос отклонён: {reopen.manager_comment||'без комментария'}</div>}<button onClick={requestReopen}>Запросить повторную смену</button></div>}
    </section>
  }

  if(!shift){return <section><h2>Сегодня</h2><div className="panel shift-start"><h2>Начало смены</h2><p>Нажмите кнопку только когда приступаете к работе. С этого момента начинается учёт рабочего времени.</p><button className="big-action" onClick={beginShift}>Начать смену</button></div></section>}

  const noTasks=!active&&queue.length===0
  const earlyApproved=early?.status==='approved'
  const canFinish=available||earlyApproved
  return <section><div className="head"><div><h2>Сегодня</h2><div className="muted">{day()} · смена №{shift.sequence_no}</div></div><Badge tone="green">На рабочем месте</Badge></div>
    <h2>Текущее задание</h2>
    {active?<div className="task active"><div className="row between"><Badge tone={active.status==='active'?'green':active.close_approved_at?'blue':'orange'}>{active.close_approved_at?'НЦ разрешил закрыть':STATUS[active.status]}</Badge><Timer startedAt={active.started_at}/></div><h2>{active.title}</h2><div className="order">Заказ {active.order_number} · позиция {active.position_number}</div><p>{active.description}</p><div>План: <b>{active.planned_minutes} мин</b></div>
      {active.status==='active'&&<><div className="split"><Field label="Фото до (необязательно)"><input type="file" accept="image/*" capture="environment" onChange={e=>upload(active,e.target.files?.[0],'before')}/>{uploaded[`${active.id}-before`]&&<small>Сохранено ✓</small>}</Field><Field label="Фото после (обязательно)"><input type="file" accept="image/*" capture="environment" onChange={e=>upload(active,e.target.files?.[0],'after')}/>{uploaded[`${active.id}-after`]&&<small>Сохранено ✓</small>}</Field></div><div className="row"><button className="secondary" onClick={()=>stop(active.id)}>Не могу продолжить</button><button onClick={()=>done(active.id)}>Завершить задание</button></div></>}
      {active.status==='stop_requested'&&!active.close_approved_at&&<div className="warning">Запрос отправлен НЦ. Ожидайте решения.</div>}
      {active.close_approved_at&&<><div className="warning">НЦ разрешил закрыть задание. Фото после не обязательно.</div><button onClick={()=>done(active.id)}>Закрыть задание</button></>}
    </div>:<div className="panel">Активного задания нет.</div>}
    <h2>Очередь</h2>
    {queue.length?queue.map((x,i)=><div className="task" key={x.id}><div className="row between"><b>#{i+1} · {x.title}</b><Badge tone={x.priority==='urgent'?'red':x.priority==='high'?'orange':'gray'}>{x.priority==='urgent'?'Срочно':x.priority==='high'?'Высокий':'Обычный'}</Badge></div><div>Заказ {x.order_number} · поз. {x.position_number}</div><div className="muted">План {x.planned_minutes} мин</div>{!active&&i===0&&<button onClick={()=>start(x.id)}>Начать задание</button>}</div>):<Empty>Следующих заданий нет — подойдите к начальнику цеха</Empty>}
    {noTasks&&completedToday>0&&<div className="panel end-shift"><h2>Все задания закончены</h2><p><b>Подойдите к начальнику цеха.</b></p>{canFinish?<button className="big-action" onClick={goReport}>Завершить смену и написать отчёт</button>:early?.status==='pending'?<div className="warning">Запрос на раннее завершение отправлен. Ожидайте решение НЦ.</div>:<button className="big-action" onClick={requestEarly}>Запросить раннее завершение смены</button>}</div>}
  </section>
}

function Report({profile}){
  const [report,setReport]=useState(null),[available,setAvailable]=useState(false),[early,setEarly]=useState(null),[u,setU]=useState({title:'',minutes:'',comment:''})
  async function load(){const d=day(),r=await supabase.rpc('get_or_build_daily_report',{p_date:d}),id=r.data,[rep,av,er]=await Promise.all([supabase.from('daily_reports').select('*,daily_report_items(*)').eq('id',id).single(),supabase.rpc('report_is_available',{p_worker_id:profile.id,p_date:d}),supabase.from('early_report_requests').select('*').eq('worker_id',profile.id).eq('work_date',d).order('created_at',{ascending:false}).limit(1)]);setReport(rep.data);setAvailable(Boolean(av.data));setEarly(er.data?.[0]||null)}
  useEffect(()=>{load()},[])
  async function comment(i,v){await supabase.from('daily_report_items').update({worker_comment:v}).eq('id',i.id);if(i.task_id)await supabase.from('report_task_comments').upsert({report_id:report.id,task_id:i.task_id,worker_comment:v},{onConflict:'report_id,task_id'})}
  async function add(){if(!u.title||!Number(u.minutes))return alert('Укажите работу и минуты');const {error}=await supabase.from('unplanned_work').insert({report_id:report.id,worker_id:profile.id,title:u.title,minutes:Number(u.minutes),comment:u.comment,status:'pending'});if(error)alert(error.message);else{setU({title:'',minutes:'',comment:''});load()}}
  async function earlyReq(){const reason=prompt('Почему нужно завершить смену раньше?');if(!reason)return;const {error}=await supabase.rpc('request_early_report',{p_reason:reason});if(error)alert(error.message);else load()}
  async function submit(){const {error}=await supabase.rpc('submit_daily_report',{p_report_date:day(),p_general_comment:document.querySelector('#gc')?.value||''});if(error)alert(error.message);else{alert('Смена завершена. Отчёт отправлен.');load()}}
  if(!report)return <Empty>Загрузка отчёта…</Empty>
  if(report.status!=='draft')return <section><h2>Отчёт · {report.report_date}</h2><div className="panel"><Badge tone={report.status==='reviewed'?'green':'blue'}>{report.status==='reviewed'?'Проверен НЦ':'Отправлен'}</Badge><p>Смена завершена, отчёт отправлен.</p></div></section>
  const canSubmit=available||early?.status==='approved'
  return <section><h2>Завершение смены · {report.report_date}</h2><div className="panel"><p>Проверьте выполненные работы, добавьте комментарии и завершите смену.</p></div>
    {(report.daily_report_items||[]).map(i=><div className="report" key={i.id}><b>{i.title}</b><div>{i.minutes} мин {i.order_number&&`· заказ ${i.order_number}/${i.position_number}`}</div><textarea defaultValue={i.worker_comment||''} placeholder="Комментарий" onBlur={e=>comment(i,e.target.value)}/></div>)}
    <div className="panel"><h3>Внеплановая работа</h3><div className="form"><Field label="Что делал"><input value={u.title} onChange={e=>setU({...u,title:e.target.value})}/></Field><Field label="Минут"><input type="number" min="1" value={u.minutes} onChange={e=>setU({...u,minutes:e.target.value})}/></Field><Field label="Комментарий" wide><input value={u.comment} onChange={e=>setU({...u,comment:e.target.value})}/></Field><button className="wide" onClick={add}>Добавить</button></div></div>
    <Field label="Общий комментарий"><textarea id="gc" defaultValue={report.worker_general_comment||''}/></Field>
    <div className="single-action">{canSubmit?<button className="big-action" onClick={submit}>Отправить отчёт и завершить смену</button>:early?.status==='pending'?<div className="warning">Запрос на раннее завершение отправлен. Ожидайте решение НЦ.</div>:<button className="big-action" onClick={earlyReq}>Запросить раннее завершение смены</button>}</div>
  </section>
}

function Pay(){
  const [x,setX]=useState(null)
  useEffect(()=>{supabase.rpc('worker_payroll_summary',{p_from:monthStart(),p_to:day()}).then(({data})=>setX(data?.[0]))},[])
  return <section><h2>Почасовая оплата</h2><div className="cards"><div className="card"><span className="muted">Начислено по часам</span><div className="kpi">{money(x?.base_pay)}</div></div><div className="card"><span className="muted">Учтено рабочего времени</span><div className="kpi">{hours(x?.worked_minutes)}</div></div></div><div className="panel">Рабочему показывается только почасовая часть начисления.</div></section>
}

function WorkerHelp(){return <section className="help"><h2>Инструкция рабочего</h2><div className="panel steps"><h3>Начало работы</h3><ol><li>Откройте сайт ФЕРРУМ и войдите под своим логином.</li><li>Нажмите <b>«Начать смену»</b> только когда реально приступили к работе.</li><li>Откройте первое задание в очереди и нажмите <b>«Начать задание»</b>.</li></ol><h3>Во время задания</h3><ol><li>Работайте только с текущим активным заданием.</li><li>Фото «до» можно добавить при необходимости. Фото «после» обязательно перед обычным завершением.</li><li>Если продолжать невозможно, нажмите <b>«Не могу продолжить»</b>, выберите причину и напишите комментарий. Ждите решения НЦ.</li><li>После выполнения нажмите <b>«Завершить задание»</b> и переходите к следующему.</li></ol><h3>Конец смены</h3><ol><li>Если заданий больше нет, подойдите к НЦ.</li><li>За 10 минут до планового конца смены появится <b>«Завершить смену и написать отчёт»</b>.</li><li>Если работа закончилась раньше, будет только <b>«Запросить раннее завершение смены»</b>. После разрешения НЦ заполните отчёт.</li><li>После отправки отчёта смена завершена, рабочее время и простой больше не считаются.</li><li>Если нужно снова выйти на работу в тот же день, нажмите <b>«Запросить повторную смену»</b> и дождитесь разрешения НЦ.</li></ol></div></section>}

function Notifications({profile}){const [rows,setRows]=useState([]);async function load(){const {data}=await supabase.from('notifications').select('*').eq('user_id',profile.id).order('created_at',{ascending:false}).limit(100);setRows(data||[])}useEffect(()=>{load()},[]);useLive('notifications',load,`user_id=eq.${profile.id}`);async function read(id){await supabase.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id);load()}return <section><h2>Уведомления</h2>{rows.length?rows.map(n=><div className={`card note ${n.read_at?'read':''}`} key={n.id} onClick={()=>read(n.id)}><div className="row between"><b>{n.title}</b>{!n.read_at&&<Badge tone="blue">Новое</Badge>}</div><div>{n.body}</div></div>):<Empty>Уведомлений нет</Empty>}</section>}
