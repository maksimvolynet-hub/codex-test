import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase } from './supabase'
import './styles.css'

const RU_STATUS = {queued:'В очереди',active:'В работе',stop_requested:'Запрос остановки',completed:'Готово',blocked_closed:'Закрыто НЦ',cancelled:'Отменено',closed_by_manager:'Закрыто НЦ'}
const STOP_REASONS = [
  ['no_material','Нет материала'],['no_components','Нет комплектующих'],['no_drawing','Нет чертежа'],['no_tool','Нет инструмента'],['broken_tool','Сломан инструмент'],['waiting_previous','Жду предыдущую операцию'],['manager_decision','Решение НЦ'],['equipment_failure','Поломка оборудования'],['other','Другое']
]

function App(){
  const [session,setSession]=useState(null)
  const [profile,setProfile]=useState(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>setSession(data.session||null)).finally(()=>setLoading(false))
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s))
    return ()=>subscription.unsubscribe()
  },[])
  useEffect(()=>{
    if(!session?.user){setProfile(null);return}
    supabase.from('profiles').select('*').eq('id',session.user.id).single().then(({data,error})=>{if(error)setError(error.message);else setProfile(data)})
  },[session])
  if(loading) return <Splash text="Загрузка…"/>
  if(!session) return <Login/>
  if(!profile) return <Splash text={error||'Загружаем профиль…'}/>
  return profile.role==='manager' ? <Manager profile={profile}/> : <Worker profile={profile}/>
}

function Login(){
  const [login,setLogin]=useState('')
  const [password,setPassword]=useState('')
  const [busy,setBusy]=useState(false)
  const [msg,setMsg]=useState('')
  async function submit(e){
    e.preventDefault(); setBusy(true); setMsg('')
    const email=login.includes('@')?login.trim():`${login.trim().toLowerCase()}@ferrum.local`
    const {error}=await supabase.auth.signInWithPassword({email,password})
    if(error)setMsg('Не удалось войти. Проверьте логин и пароль.')
    setBusy(false)
  }
  return <div className="auth-page"><form className="auth-card" onSubmit={submit}>
    <div className="brand">ФЕРРУМ</div><div className="muted">Производство</div>
    <label>Логин или e-mail<input value={login} onChange={e=>setLogin(e.target.value)} autoComplete="username" required/></label>
    <label>Пароль<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/></label>
    {msg&&<div className="error">{msg}</div>}<button disabled={busy}>{busy?'Входим…':'Войти'}</button>
  </form></div>
}

function Shell({title,profile,children,actions}){
  return <div className="app"><header><div><div className="brand small">ФЕРРУМ</div><div className="page-title">{title}</div></div><div className="header-actions">{actions}<span className="who">{profile.full_name}</span><button className="ghost" onClick={()=>supabase.auth.signOut()}>Выйти</button></div></header>{children}</div>
}

function Manager({profile}){
  const [tab,setTab]=useState('shop')
  const tabs=[['shop','Цех сейчас'],['tasks','Задания'],['workers','Рабочие'],['reports','Отчёты'],['salary','Зарплата']]
  return <Shell title="Панель начальника цеха" profile={profile}><nav className="tabs">{tabs.map(([k,n])=><button key={k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{n}</button>)}</nav><main>
    {tab==='shop'&&<ShopNow/>}{tab==='tasks'&&<ManagerTasks profile={profile}/>} {tab==='workers'&&<Workers/>}{tab==='reports'&&<Reports/>}{tab==='salary'&&<Salary/>}
  </main></Shell>
}

function ShopNow(){
  const [rows,setRows]=useState([])
  async function load(){
    const {data}=await supabase.from('profiles').select('id,full_name,job_title,status').eq('role','worker').eq('active',true).order('full_name')
    const workers=data||[]
    const ids=workers.map(x=>x.id)
    let tasks=[]; if(ids.length){const r=await supabase.from('tasks').select('id,assigned_to,title,order_number,position_number,status,started_at').in('assigned_to',ids).in('status',['active','stop_requested']);tasks=r.data||[]}
    setRows(workers.map(w=>({...w,task:tasks.find(t=>t.assigned_to===w.id)})))
  }
  useEffect(()=>{load(); const ch=supabase.channel('shop-now').on('postgres_changes',{event:'*',schema:'public',table:'tasks'},load).subscribe();return()=>supabase.removeChannel(ch)},[])
  return <section><h2>Цех сейчас</h2><div className="cards">{rows.length?rows.map(r=><div className="card" key={r.id}><div className="row between"><b>{r.full_name}</b><span className={'badge '+(r.task?'green':'gray')}>{r.task?'Работает':'Без активного задания'}</span></div><div className="muted">{r.job_title||'—'}</div>{r.task?<><h3>{r.task.title}</h3><div>Заказ {r.task.order_number} · поз. {r.task.position_number}</div></>:<div className="warning">Нужно назначить следующее задание</div>}</div>):<Empty text="Рабочих пока нет"/>}</div></section>
}

function Workers(){
  const [workers,setWorkers]=useState([]),[open,setOpen]=useState(false)
  const [form,setForm]=useState({login:'',password:'',full_name:'',position:'',break_group:'general',shift_start:'08:00',shift_end:'17:00',base_rate_8h:''})
  const [msg,setMsg]=useState('')
  async function load(){const {data}=await supabase.from('profiles').select('*').eq('role','worker').order('full_name');setWorkers(data||[])}
  useEffect(()=>{load()},[])
  async function create(e){e.preventDefault();setMsg('');const {data,error}=await supabase.functions.invoke('create-worker',{body:form});if(error||!data?.ok){setMsg(data?.error||error?.message||'Ошибка создания');return}setOpen(false);setForm({login:'',password:'',full_name:'',position:'',break_group:'general',shift_start:'08:00',shift_end:'17:00',base_rate_8h:''});load()}
  return <section><div className="row between"><h2>Рабочие</h2><button onClick={()=>setOpen(!open)}>+ Добавить рабочего</button></div>{open&&<form className="panel form-grid" onSubmit={create}>
    <label>Логин<input required value={form.login} onChange={e=>setForm({...form,login:e.target.value})}/></label><label>Пароль<input required minLength="6" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label><label>ФИО<input required value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})}/></label><label>Должность<input value={form.position} onChange={e=>setForm({...form,position:e.target.value})}/></label><label>Начало смены<input type="time" value={form.shift_start} onChange={e=>setForm({...form,shift_start:e.target.value})}/></label><label>Конец смены<input type="time" value={form.shift_end} onChange={e=>setForm({...form,shift_end:e.target.value})}/></label><label>Ставка за 8 ч<input type="number" min="0" value={form.base_rate_8h} onChange={e=>setForm({...form,base_rate_8h:e.target.value})}/></label><label>Группа перерывов<select value={form.break_group} onChange={e=>setForm({...form,break_group:e.target.value})}><option value="general">Общая</option><option value="mechanics">Механики / ленточка / маляр</option><option value="welders">Сварщики / плазма</option></select></label>{msg&&<div className="error span2">{msg}</div>}<button className="span2">Создать</button></form>}
    <div className="table-wrap"><table><thead><tr><th>Рабочий</th><th>Должность</th><th>Смена</th><th>Ставка/8ч</th></tr></thead><tbody>{workers.map(w=><tr key={w.id}><td>{w.full_name}<div className="muted">{w.login}</div></td><td>{w.job_title||'—'}</td><td>{w.shift_start?.slice(0,5)}–{w.shift_end?.slice(0,5)}</td><td>{Number(w.rate_8h||0).toLocaleString('ru-RU')} ₽</td></tr>)}</tbody></table></div>
  </section>
}

function ManagerTasks({profile}){
  const [workers,setWorkers]=useState([]),[tasks,setTasks]=useState([]),[requests,setRequests]=useState([])
  const [form,setForm]=useState({assigned_to:'',order_number:'',position_number:'',product_name:'',title:'',description:'',planned_minutes:60,planned_date:'',priority:'normal'})
  async function load(){const [w,t,r]=await Promise.all([supabase.from('profiles').select('id,full_name').eq('role','worker').eq('active',true).order('full_name'),supabase.from('tasks').select('*,profiles!tasks_assigned_to_fkey(full_name)').order('created_at',{ascending:false}).limit(100),supabase.from('stop_requests').select('*,tasks(title,order_number,position_number),profiles!stop_requests_worker_id_fkey(full_name)').eq('status','pending').order('created_at')]);setWorkers(w.data||[]);setTasks(t.data||[]);setRequests(r.data||[])}
  useEffect(()=>{load(); const ch=supabase.channel('mgr-tasks').on('postgres_changes',{event:'*',schema:'public',table:'tasks'},load).on('postgres_changes',{event:'*',schema:'public',table:'stop_requests'},load).subscribe();return()=>supabase.removeChannel(ch)},[])
  async function create(e){e.preventDefault();const queue=Math.max(0,...tasks.filter(t=>t.assigned_to===form.assigned_to&&t.status==='queued').map(t=>t.queue_order||0))+1;const {error}=await supabase.from('tasks').insert({...form,planned_minutes:Number(form.planned_minutes),planned_date:form.planned_date||null,queue_order:queue,created_by:profile.id});if(error)alert(error.message);else{setForm({...form,order_number:'',position_number:'',product_name:'',title:'',description:'',planned_minutes:60,planned_date:''});load()}}
  async function resolve(id,approve){const c=prompt(approve?'Комментарий НЦ:':'Укажите обязательную инструкцию рабочему:');if(!c)return;const {error}=await supabase.rpc('resolve_stop_request',{p_request_id:id,p_approve:approve,p_manager_comment:c});if(error)alert(error.message);load()}
  return <section><h2>Задания</h2>{requests.length>0&&<div className="panel danger-panel"><h3>Запросы рабочих</h3>{requests.map(r=><div className="request" key={r.id}><div><b>{r.profiles?.full_name}</b> · {r.tasks?.title}<div className="muted">Заказ {r.tasks?.order_number} · поз. {r.tasks?.position_number}</div><div>{r.worker_comment||'Без комментария'}</div></div><div className="row"><button onClick={()=>resolve(r.id,true)}>Разрешить закрыть</button><button className="secondary" onClick={()=>resolve(r.id,false)}>Отклонить</button></div></div>)}</div>}
    <form className="panel form-grid" onSubmit={create}><label>Рабочий<select required value={form.assigned_to} onChange={e=>setForm({...form,assigned_to:e.target.value})}><option value="">Выберите</option>{workers.map(w=><option key={w.id} value={w.id}>{w.full_name}</option>)}</select></label><label>Приоритет<select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочно</option></select></label><label>№ заказа<input required value={form.order_number} onChange={e=>setForm({...form,order_number:e.target.value})}/></label><label>Позиция<input required value={form.position_number} onChange={e=>setForm({...form,position_number:e.target.value})}/></label><label>Изделие<input value={form.product_name} onChange={e=>setForm({...form,product_name:e.target.value})}/></label><label>Операция<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label><label>План, мин<input type="number" min="1" required value={form.planned_minutes} onChange={e=>setForm({...form,planned_minutes:e.target.value})}/></label><label>Дата плана<input type="date" value={form.planned_date} onChange={e=>setForm({...form,planned_date:e.target.value})}/></label><label className="span2">Описание<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label><button className="span2">Поставить в очередь</button></form>
    <div className="table-wrap"><table><thead><tr><th>Рабочий</th><th>Заказ / позиция</th><th>Операция</th><th>План</th><th>Статус</th></tr></thead><tbody>{tasks.map(t=><tr key={t.id}><td>{t.profiles?.full_name}</td><td>{t.order_number} / {t.position_number}</td><td>{t.title}</td><td>{t.planned_minutes} мин</td><td><span className={'badge '+(t.status==='active'?'green':t.status==='stop_requested'?'orange':'gray')}>{RU_STATUS[t.status]||t.status}</span></td></tr>)}</tbody></table></div>
  </section>
}

function Reports(){
  const [reports,setReports]=useState([]),[selected,setSelected]=useState(null),[review,setReview]=useState({safety:22,prod:0,penalty:0,safetyReason:'',penaltyReason:'',comment:''})
  async function load(){const {data}=await supabase.from('daily_reports').select('*,profiles!daily_reports_worker_id_fkey(full_name),daily_report_items(*)').in('status',['submitted','reviewed']).order('report_date',{ascending:false});setReports(data||[])}
  useEffect(()=>{load()},[])
  async function save(){if(!selected)return;const {error}=await supabase.rpc('review_daily_report',{p_report_id:selected.id,p_safety:Number(review.safety),p_productivity:Number(review.prod),p_penalty:Number(review.penalty),p_safety_reason:review.safetyReason||null,p_penalty_reason:review.penaltyReason||null,p_comment:review.comment||null});if(error)alert(error.message);else{setSelected(null);load()}}
  return <section><h2>Отчёты</h2><div className="cards">{reports.map(r=><div className="card" key={r.id}><div className="row between"><b>{r.profiles?.full_name}</b><span className={'badge '+(r.status==='reviewed'?'green':'orange')}>{r.status==='reviewed'?'Проверен':'Непроверен'}</span></div><div className="muted">{r.report_date}</div><div>{r.daily_report_items?.length||0} записей</div>{r.status==='submitted'&&<button onClick={()=>setSelected(r)}>Проверить отчёт</button>}</div>)}</div>{selected&&<div className="modal-back"><div className="modal"><h3>Проверка отчёта · {selected.profiles?.full_name}</h3><div className="report-items">{selected.daily_report_items?.map(i=><div key={i.id}>{i.title} — {i.minutes} мин <span className="muted">{i.order_number?`Заказ ${i.order_number}, поз. ${i.position_number}`:''}</span></div>)}</div><div className="form-grid"><label>ТБ, %<input type="number" min="0" max="22" value={review.safety} onChange={e=>setReview({...review,safety:e.target.value})}/></label><label>Выработка, %<input type="number" min="0" max="18" value={review.prod} onChange={e=>setReview({...review,prod:e.target.value})}/></label><label>Штраф / корректировка, ₽<input type="number" min="0" value={review.penalty} onChange={e=>setReview({...review,penalty:e.target.value})}/></label><label>Причина снижения ТБ<input value={review.safetyReason} onChange={e=>setReview({...review,safetyReason:e.target.value})}/></label><label className="span2">Причина штрафа<input value={review.penaltyReason} onChange={e=>setReview({...review,penaltyReason:e.target.value})}/></label><label className="span2">Комментарий НЦ<textarea value={review.comment} onChange={e=>setReview({...review,comment:e.target.value})}/></label></div><div className="row end"><button className="secondary" onClick={()=>setSelected(null)}>Отмена</button><button onClick={save}>Проверить и сохранить</button></div></div></div>}</section>
}

function Salary(){
  const [workers,setWorkers]=useState([]),[from,setFrom]=useState(new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().slice(0,10)),[to,setTo]=useState(new Date().toISOString().slice(0,10)),[data,setData]=useState({})
  useEffect(()=>{supabase.from('profiles').select('id,full_name').eq('role','worker').eq('active',true).order('full_name').then(({data})=>setWorkers(data||[]))},[])
  async function load(){const out={};for(const w of workers){const {data,error}=await supabase.rpc('manager_payroll_details',{p_worker:w.id,p_from:from,p_to:to});if(!error){const minutes=(data||[]).reduce((s,x)=>s+Number(x.worked_minutes||0),0);const penalties=(data||[]).reduce((s,x)=>s+Number(x.penalty_amount||0),0);out[w.id]={rows:data||[],minutes,penalties}}}setData(out)}
  return <section><div className="row between"><h2>Зарплата</h2><div className="row"><input type="date" value={from} onChange={e=>setFrom(e.target.value)}/><input type="date" value={to} onChange={e=>setTo(e.target.value)}/><button onClick={load}>Рассчитать</button></div></div><div className="cards">{workers.map(w=><div className="card" key={w.id}><b>{w.full_name}</b><div className="kpi">{Math.round((data[w.id]?.minutes||0)/60*10)/10} ч</div><div className="muted">Проверенных смен: {data[w.id]?.rows?.length||0}</div><div>Штрафы: {(data[w.id]?.penalties||0).toLocaleString('ru-RU')} ₽</div></div>)}</div></section>
}

function Worker({profile}){
  const [tasks,setTasks]=useState([]),[photos,setPhotos]=useState({}),[pay,setPay]=useState(null)
  async function load(){const {data}=await supabase.from('tasks').select('*').eq('assigned_to',profile.id).in('status',['queued','active','stop_requested']).order('priority',{ascending:false}).order('queue_order');setTasks(data||[])}
  useEffect(()=>{load(); const ch=supabase.channel('worker-tasks').on('postgres_changes',{event:'*',schema:'public',table:'tasks',filter:`assigned_to=eq.${profile.id}`},load).subscribe();return()=>supabase.removeChannel(ch)},[])
  const active=tasks.find(t=>['active','stop_requested'].includes(t.status)); const queue=tasks.filter(t=>t.status==='queued')
  async function start(id){const {error}=await supabase.rpc('start_task',{p_task_id:id});if(error)alert(error.message);load()}
  async function requestStop(id){const reason=prompt('Причина: no_material, no_components, no_drawing, no_tool, broken_tool, waiting_previous, manager_decision, equipment_failure, other','no_material');if(!reason)return;const comment=prompt('Комментарий:','')||'';const {error}=await supabase.rpc('request_task_stop',{p_task_id:id,p_reason:reason,p_comment:comment});if(error)alert(error.message);load()}
  async function upload(task,file,kind='after'){if(!file)return;const ext=(file.name.split('.').pop()||'jpg').toLowerCase();const path=`${profile.id}/${task.id}/${Date.now()}-${kind}.${ext}`;const up=await supabase.storage.from('task-photos').upload(path,file,{upsert:false});if(up.error){alert(up.error.message);return}const ins=await supabase.from('task_photos').insert({task_id:task.id,worker_id:profile.id,kind,object_path:path,storage_path:path});if(ins.error){alert(ins.error.message);return}setPhotos({...photos,[task.id]:true})}
  async function complete(task){const {error}=await supabase.rpc('complete_task',{p_task_id:task.id});if(error)alert(error.message);load()}
  async function payroll(){const now=new Date(),from=new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10),to=now.toISOString().slice(0,10);const {data}=await supabase.rpc('worker_payroll_summary',{p_from:from,p_to:to});setPay(data?.[0]||null)}
  useEffect(()=>{payroll()},[])
  return <Shell title="Рабочее место" profile={profile}><main className="worker-main"><section><h2>Текущее задание</h2>{active?<div className="task-card active-task"><div className="row between"><span className="badge green">{RU_STATUS[active.status]}</span><Timer startedAt={active.started_at}/></div><h2>{active.title}</h2><div className="order">Заказ {active.order_number} · позиция {active.position_number}</div><p>{active.description}</p><div className="muted">План: {active.planned_minutes} мин</div>{active.status==='active'&&<><div className="upload-box"><label>Фото результата — обязательно<input type="file" accept="image/*" capture="environment" onChange={e=>upload(active,e.target.files?.[0],'after')}/></label>{photos[active.id]&&<span className="ok">Фото добавлено ✓</span>}</div><div className="row"><button className="secondary" onClick={()=>requestStop(active.id)}>Не могу продолжить</button><button onClick={()=>complete(active)}>Завершить</button></div></>}{active.status==='stop_requested'&&<div className="warning">Запрос отправлен НЦ. Ожидайте решения.</div>}</div>:<div className="panel"><b>Активного задания нет</b><p>Если очередь пустая — подойдите к начальнику цеха.</p></div>}</section>
    <section><h2>Очередь</h2>{queue.length?queue.map((t,i)=><div className="task-card" key={t.id}><div className="row between"><span>#{i+1}</span><span className={'badge '+(t.priority==='urgent'?'red':t.priority==='high'?'orange':'gray')}>{t.priority==='urgent'?'Срочно':t.priority==='high'?'Высокий':'Обычный'}</span></div><h3>{t.title}</h3><div>Заказ {t.order_number} · поз. {t.position_number}</div><div className="muted">План {t.planned_minutes} мин</div>{!active&&i===0&&<button onClick={()=>start(t.id)}>Начать задание</button>}</div>):<Empty text="Следующих заданий нет — подойдите к начальнику цеха"/>}</section>
    <section><h2>Зарплата</h2><div className="panel">{pay?<><div className="kpi">{Number(pay.total_pay||0).toLocaleString('ru-RU')} ₽</div><div>ТБ: {Number(pay.avg_safety||0).toFixed(1)}%</div><div>Проверено времени: {Math.round(Number(pay.worked_minutes||0)/60*10)/10} ч</div><div className="muted">Коэффициент выработки учтён в итоговой сумме, но не отображается.</div></>:<div className="muted">Пока нет проверенных смен</div>}</div></section>
  </main></Shell>
}

function Timer({startedAt}){const [now,setNow]=useState(Date.now());useEffect(()=>{const i=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(i)},[]);const s=Math.max(0,Math.floor((now-new Date(startedAt).getTime())/1000)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60;return <b className="timer">{String(h).padStart(2,'0')}:{String(m).padStart(2,'0')}:{String(sec).padStart(2,'0')}</b>}
function Empty({text}){return <div className="empty">{text}</div>}
function Splash({text}){return <div className="auth-page"><div className="auth-card"><div className="brand">ФЕРРУМ</div><p>{text}</p></div></div>}

createRoot(document.getElementById('root')).render(<App/>)
