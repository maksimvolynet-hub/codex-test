import React,{useEffect,useState} from 'react'
import {supabase} from './supabase'
import {Header,Nav,Badge,Field,Empty,STATUS,BREAKS,day,hm,useLive} from './common-v2'
import {Reports,Planning,Labor,Downtime,Payroll} from './manager-reports-v2'

export function Manager({profile}){
  const [tab,setTab]=useState('shop')
  const items=[['shop','Цех сейчас'],['tasks','Задания'],['reports','Отчёты'],['workers','Рабочие'],['planning','План загрузки'],['labor','Трудозатраты'],['downtime','Простои'],['payroll','Зарплата']]
  return <><Header profile={profile} title="Панель начальника цеха"/><main><Nav items={items} value={tab} onChange={setTab}/>
    {tab==='shop'&&<Shop/>}
    {tab==='tasks'&&<Tasks profile={profile}/>}
    {tab==='reports'&&<Reports/>}
    {tab==='workers'&&<Workers profile={profile}/>}
    {tab==='planning'&&<Planning/>}
    {tab==='labor'&&<Labor/>}
    {tab==='downtime'&&<Downtime/>}
    {tab==='payroll'&&<Payroll/>}
  </main></>
}

function Shop(){
  const [rows,setRows]=useState([]),[early,setEarly]=useState([]),[stop,setStop]=useState([])
  async function load(){
    const [s,e,r]=await Promise.all([
      supabase.rpc('get_manager_worker_status_v2'),
      supabase.from('early_report_requests').select('*,profiles!early_report_requests_worker_id_fkey(full_name)').eq('status','pending'),
      supabase.from('stop_requests').select('*,profiles!stop_requests_worker_id_fkey(full_name),tasks(title,order_number,position_number)').eq('status','pending')
    ])
    setRows(s.data||[]);setEarly(e.data||[]);setStop(r.data||[])
  }
  useEffect(()=>{load()},[]);useLive('tasks',load);useLive('stop_requests',load);useLive('early_report_requests',load)
  async function stopResolve(id,ok){const c=prompt(ok?'Комментарий НЦ:':'Обязательная инструкция рабочему:');if(!c)return;const {error}=await supabase.rpc('resolve_stop_request',{p_request_id:id,p_approve:ok,p_manager_comment:c});if(error)alert(error.message);else load()}
  async function earlyResolve(id,ok){const c=prompt('Комментарий НЦ:','')||'';const {error}=await supabase.rpc('resolve_early_report',{p_request_id:id,p_approve:ok,p_comment:c});if(error)alert(error.message);else load()}
  return <section><div className="head"><div><h2>Цех сейчас</h2><div className="muted">Екатеринбург · {day()}</div></div><button className="secondary" onClick={load}>Обновить</button></div>
    {(stop.length||early.length)>0&&<div className="alerts">
      {stop.map(x=><div className="alert" key={x.id}><b>{x.profiles?.full_name}: запрос по заданию</b><div>{x.tasks?.title} · {x.worker_comment||'без комментария'}</div><div className="row"><button onClick={()=>stopResolve(x.id,true)}>Разрешить закрыть</button><button className="secondary" onClick={()=>stopResolve(x.id,false)}>Отклонить</button></div></div>)}
      {early.map(x=><div className="alert" key={x.id}><b>{x.profiles?.full_name}: ранний отчёт</b><div>{x.reason}</div><div className="row"><button onClick={()=>earlyResolve(x.id,true)}>Разрешить</button><button className="secondary" onClick={()=>earlyResolve(x.id,false)}>Отклонить</button></div></div>)}
    </div>}
    <div className="cards">{rows.length?rows.map(r=>{const tone=r.overdue?'red':r.live_status==='working'?'green':r.live_status==='waiting_manager'?'orange':r.live_status==='close_approved'?'blue':'gray';return <div className="card" key={r.worker_id}><div className="row between"><b>{r.full_name}</b><Badge tone={tone}>{r.overdue?'План превышен':r.live_status==='working'?'Работает':r.live_status==='waiting_manager'?'Ждёт НЦ':r.live_status==='close_approved'?'Можно закрыть':'Простой'}</Badge></div><div className="muted">{r.position||'—'}</div>{r.order_number?<><h3>{r.operation_name}</h3><div>Заказ {r.order_number} · поз. {r.position_number}</div><div className="metrics"><span>План <b>{r.plan_minutes||0} мин</b></span><span>Факт <b>{r.elapsed_minutes||0} мин</b></span></div></>:<div className="warning">Нет активного задания</div>}</div>}):<Empty>Рабочих пока нет</Empty>}</div>
  </section>
}

function Tasks({profile}){
  const [workers,setWorkers]=useState([]),[tasks,setTasks]=useState([]),[selected,setSelected]=useState(null)
  const [form,setForm]=useState({assigned_to:'',order_number:'',position_number:'',product_name:'',title:'',description:'',planned_minutes:60,planned_date:day(),priority:'normal'})
  async function load(){
    const [w,t]=await Promise.all([
      supabase.from('profiles').select('id,full_name').eq('role','worker').eq('active',true).order('full_name'),
      supabase.from('tasks').select('*,profiles!tasks_assigned_to_fkey(full_name)').order('created_at',{ascending:false}).limit(200)
    ])
    setWorkers(w.data||[]);setTasks(t.data||[])
    if(selected){const fresh=(t.data||[]).find(x=>x.id===selected.id);if(fresh)setSelected(fresh)}
  }
  useEffect(()=>{load()},[]);useLive('tasks',load)
  async function add(e){e.preventDefault();const q=Math.max(0,...tasks.filter(t=>t.assigned_to===form.assigned_to&&t.status==='queued').map(t=>Number(t.queue_order||0)))+1;const {error}=await supabase.from('tasks').insert({...form,planned_minutes:Number(form.planned_minutes),planned_date:form.planned_date||null,queue_order:q,created_by:profile.id});if(error)alert(error.message);else{setForm({...form,order_number:'',position_number:'',product_name:'',title:'',description:'',planned_minutes:60});load()}}
  async function move(id,d){const {error}=await supabase.rpc('manager_move_task',{p_task_id:id,p_direction:d});if(error)alert(error.message);else load()}
  async function saveTask(e){e.preventDefault();if(!selected||selected.status!=='queued')return;const z=Object.fromEntries(new FormData(e.currentTarget));const patch={assigned_to:z.assigned_to,order_number:z.order_number.trim(),position_number:z.position_number.trim(),product_name:z.product_name.trim(),title:z.title.trim(),description:z.description.trim(),planned_minutes:Number(z.planned_minutes),planned_date:z.planned_date||null,priority:z.priority};const {error}=await supabase.from('tasks').update(patch).eq('id',selected.id);if(error)alert(error.message);else{setSelected(null);load()}}
  async function cancelTask(){if(!selected||selected.status!=='queued')return;if(!confirm('Отменить это задание? Оно останется в истории со статусом «Отменено».'))return;const {error}=await supabase.from('tasks').update({status:'cancelled'}).eq('id',selected.id);if(error)alert(error.message);else{setSelected(null);load()}}
  return <section><h2>Задания</h2>
    <form className="panel form" onSubmit={add}>
      <Field label="Рабочий"><select required value={form.assigned_to} onChange={e=>setForm({...form,assigned_to:e.target.value})}><option value="">Выберите</option>{workers.map(w=><option key={w.id} value={w.id}>{w.full_name}</option>)}</select></Field>
      <Field label="Приоритет"><select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочно</option></select></Field>
      <Field label="№ заказа"><input required value={form.order_number} onChange={e=>setForm({...form,order_number:e.target.value})}/></Field>
      <Field label="Позиция"><input required value={form.position_number} onChange={e=>setForm({...form,position_number:e.target.value})}/></Field>
      <Field label="Изделие"><input value={form.product_name} onChange={e=>setForm({...form,product_name:e.target.value})}/></Field>
      <Field label="Операция"><input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></Field>
      <Field label="План, мин"><input type="number" min="1" value={form.planned_minutes} onChange={e=>setForm({...form,planned_minutes:e.target.value})}/></Field>
      <Field label="Дата"><input type="date" value={form.planned_date} onChange={e=>setForm({...form,planned_date:e.target.value})}/></Field>
      <Field label="Описание" wide><textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></Field>
      <button className="wide">Поставить в очередь</button>
    </form>
    <div className="table"><table><thead><tr><th>Рабочий</th><th>Заказ</th><th>Операция</th><th>План</th><th>Статус</th><th>Очередь</th><th></th></tr></thead><tbody>{tasks.map(t=><tr key={t.id}><td>{t.profiles?.full_name||'—'}</td><td>{t.order_number} / {t.position_number}</td><td>{t.title}</td><td>{t.planned_minutes} мин</td><td><Badge tone={t.status==='active'?'green':t.status==='stop_requested'?'orange':t.status==='cancelled'?'red':'gray'}>{STATUS[t.status]||t.status}</Badge></td><td>{t.status==='queued'&&<div className="row"><button className="icon" onClick={()=>move(t.id,-1)}>↑</button><button className="icon" onClick={()=>move(t.id,1)}>↓</button></div>}</td><td><button className="secondary" onClick={()=>setSelected(t)}>Открыть</button></td></tr>)}</tbody></table></div>
    {selected&&<div className="modal"><div className="modal-card"><div className="row between"><div><h3>{selected.title}</h3><div className="muted">Заказ {selected.order_number} · позиция {selected.position_number}</div></div><button className="ghost" onClick={()=>setSelected(null)}>Закрыть</button></div>
      {selected.status==='queued'?<form className="form" onSubmit={saveTask}>
        <Field label="Рабочий"><select name="assigned_to" defaultValue={selected.assigned_to} required>{workers.map(w=><option key={w.id} value={w.id}>{w.full_name}</option>)}</select></Field>
        <Field label="Приоритет"><select name="priority" defaultValue={selected.priority}><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочно</option></select></Field>
        <Field label="№ заказа"><input name="order_number" defaultValue={selected.order_number} required/></Field>
        <Field label="Позиция"><input name="position_number" defaultValue={selected.position_number} required/></Field>
        <Field label="Изделие"><input name="product_name" defaultValue={selected.product_name||''}/></Field>
        <Field label="Операция"><input name="title" defaultValue={selected.title} required/></Field>
        <Field label="План, мин"><input name="planned_minutes" type="number" min="1" defaultValue={selected.planned_minutes} required/></Field>
        <Field label="Дата"><input name="planned_date" type="date" defaultValue={selected.planned_date||''}/></Field>
        <Field label="Описание" wide><textarea name="description" defaultValue={selected.description||''}/></Field>
        <div className="wide row between"><button>Сохранить изменения</button><button type="button" className="danger" onClick={cancelTask}>Отменить задание</button></div>
      </form>:<div className="panel"><div className="detail-grid"><div><span className="muted">Рабочий</span><b>{selected.profiles?.full_name||'—'}</b></div><div><span className="muted">Статус</span><b>{STATUS[selected.status]||selected.status}</b></div><div><span className="muted">Изделие</span><b>{selected.product_name||'—'}</b></div><div><span className="muted">План</span><b>{selected.planned_minutes||0} мин</b></div><div><span className="muted">Факт</span><b>{selected.actual_minutes??'—'} мин</b></div><div><span className="muted">Дата плана</span><b>{selected.planned_date||'—'}</b></div></div><h4>Описание</h4><div>{selected.description||'—'}</div></div>}
    </div></div>}
  </section>
}

function Workers({profile}){
  const [workers,setWorkers]=useState([]),[open,setOpen]=useState(false),[ov,setOv]=useState(null),[busy,setBusy]=useState(false),[msg,setMsg]=useState('')
  const [f,setF]=useState({login:'',password:'',full_name:'',position:'',break_group:'general',shift_start:'08:00',shift_end:'17:00',base_rate_8h:''})
  async function load(){const {data}=await supabase.from('profiles').select('*').eq('role','worker').order('full_name');setWorkers(data||[])}
  useEffect(()=>{load()},[])
  async function create(e){e.preventDefault();setBusy(true);setMsg('');const {data,error}=await supabase.functions.invoke('create-worker',{body:f});setBusy(false);if(error||!data?.ok){setMsg(data?.error||error?.message||'Не удалось создать рабочего');return}setOpen(false);setF({login:'',password:'',full_name:'',position:'',break_group:'general',shift_start:'08:00',shift_end:'17:00',base_rate_8h:''});load()}
  async function saveOv(e){e.preventDefault();const z=Object.fromEntries(new FormData(e.currentTarget)),{error}=await supabase.from('shift_overrides').upsert({worker_id:ov.id,work_date:z.date,shift_start:z.start,shift_end:z.end,report_lead_minutes:10,status:'working',note:z.note,created_by:profile.id},{onConflict:'worker_id,work_date'});if(error)alert(error.message);else setOv(null)}
  return <section><div className="head"><h2>Рабочие</h2><button onClick={()=>{setOpen(!open);setMsg('')}}>+ Добавить рабочего</button></div>
    {open&&<form className="panel form" onSubmit={create}>
      <Field label="Логин"><input required value={f.login} onChange={e=>setF({...f,login:e.target.value})}/></Field><Field label="Пароль"><input type="password" minLength="6" required value={f.password} onChange={e=>setF({...f,password:e.target.value})}/></Field><Field label="ФИО"><input required value={f.full_name} onChange={e=>setF({...f,full_name:e.target.value})}/></Field><Field label="Должность"><input value={f.position} onChange={e=>setF({...f,position:e.target.value})}/></Field>
      <Field label="Начало смены"><input type="time" value={f.shift_start} onChange={e=>setF({...f,shift_start:e.target.value})}/></Field><Field label="Конец смены"><input type="time" value={f.shift_end} onChange={e=>setF({...f,shift_end:e.target.value})}/></Field><Field label="Перерывы"><select value={f.break_group} onChange={e=>setF({...f,break_group:e.target.value})}>{BREAKS.map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></Field><Field label="Ставка / 8ч"><input type="number" min="0" value={f.base_rate_8h} onChange={e=>setF({...f,base_rate_8h:e.target.value})}/></Field>
      {msg&&<div className="error wide">{msg}</div>}<button className="wide" disabled={busy}>{busy?'Создаём…':'Создать рабочего'}</button>
    </form>}
    <div className="table"><table><thead><tr><th>Рабочий</th><th>Должность</th><th>Смена</th><th>Ставка</th><th></th></tr></thead><tbody>{workers.map(w=><tr key={w.id}><td><b>{w.full_name}</b><div className="muted">{w.login}</div></td><td>{w.job_title}</td><td>{hm(w.shift_start)}–{hm(w.shift_end)}</td><td>{Number(w.rate_8h||0).toLocaleString('ru-RU')} ₽</td><td><button className="secondary" onClick={()=>setOv(w)}>Смена-исключение</button></td></tr>)}</tbody></table></div>
    {ov&&<div className="modal"><form className="modal-card" onSubmit={saveOv}><div className="row between"><h3>{ov.full_name}</h3><button type="button" className="ghost" onClick={()=>setOv(null)}>Закрыть</button></div><Field label="Дата"><input name="date" type="date" defaultValue={day()} required/></Field><div className="split"><Field label="Начало"><input name="start" type="time" defaultValue={hm(ov.shift_start)} required/></Field><Field label="Конец"><input name="end" type="time" defaultValue={hm(ov.shift_end)} required/></Field></div><Field label="Комментарий"><textarea name="note"/></Field><button>Сохранить</button></form></div>}
  </section>
}
