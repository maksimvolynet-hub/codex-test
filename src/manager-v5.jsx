import React,{useEffect,useState} from 'react'
import {supabase} from './supabase'
import {Manager as ManagerV4} from './manager-core-v4'

export function Manager({profile}){
  const [requests,setRequests]=useState([])
  const [loadError,setLoadError]=useState('')
  const [busy,setBusy]=useState(false)

  async function loadRequests(){
    const {data,error}=await supabase
      .from('shift_reopen_requests')
      .select('id,worker_id,reason,created_at,status')
      .eq('status','pending')
      .order('created_at',{ascending:true})

    if(error){
      setLoadError(error.message||'Не удалось загрузить запросы повторной смены')
      return
    }

    const rows=data||[]
    if(!rows.length){
      setRequests([])
      setLoadError('')
      return
    }

    const workerIds=[...new Set(rows.map(x=>x.worker_id).filter(Boolean))]
    const {data:people,error:peopleError}=await supabase
      .from('profiles')
      .select('id,full_name')
      .in('id',workerIds)

    if(peopleError){
      setLoadError(peopleError.message||'Не удалось загрузить имена рабочих')
      setRequests(rows.map(x=>({...x,worker_name:'Рабочий'})))
      return
    }

    const names=Object.fromEntries((people||[]).map(x=>[x.id,x.full_name]))
    setRequests(rows.map(x=>({...x,worker_name:names[x.worker_id]||'Рабочий'})))
    setLoadError('')
  }

  async function resolve(id,approve){
    const comment=prompt(approve?'Комментарий НЦ к повторной смене:':'Причина отказа:','')||''
    setBusy(true)
    const {error}=await supabase.rpc('resolve_shift_reopen',{
      p_request_id:id,
      p_approve:approve,
      p_comment:comment
    })
    setBusy(false)
    if(error){
      alert(error.message)
      return
    }
    await loadRequests()
  }

  useEffect(()=>{
    loadRequests()
    const timer=setInterval(loadRequests,2000)
    const channel=supabase
      .channel(`manager-shift-reopen-${profile.id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'shift_reopen_requests'},loadRequests)
      .on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${profile.id}`},loadRequests)
      .subscribe()
    return()=>{
      clearInterval(timer)
      supabase.removeChannel(channel)
    }
  },[profile.id])

  const first=requests[0]

  return <>
    {loadError&&<div style={{position:'fixed',right:'16px',top:'16px',zIndex:10000,width:'min(480px,calc(100vw - 32px))',background:'#fef2f2',border:'2px solid #dc2626',borderRadius:'14px',padding:'14px 16px',boxShadow:'0 10px 30px rgba(0,0,0,.18)'}}>
      <div style={{fontWeight:800,marginBottom:'4px'}}>Ошибка уведомлений НЦ</div>
      <div style={{fontSize:'13px'}}>{loadError}</div>
      <button style={{marginTop:'10px'}} onClick={loadRequests}>Повторить</button>
    </div>}

    {!loadError&&requests.length>0&&<div style={{position:'fixed',right:'16px',top:'16px',zIndex:9999,width:'min(460px,calc(100vw - 32px))',background:'#fff7ed',border:'3px solid #f97316',borderRadius:'14px',padding:'16px',boxShadow:'0 10px 30px rgba(0,0,0,.22)'}}>
      <div style={{fontWeight:900,fontSize:'18px',marginBottom:'8px'}}>🔔 Запрос на повторную смену</div>
      <div style={{fontSize:'16px'}}><b>{first?.worker_name||'Рабочий'}</b>{requests.length>1?` · ещё запросов: ${requests.length-1}`:''}</div>
      <div style={{marginTop:'6px'}}>{first?.reason||'Причина не указана'}</div>
      <div style={{display:'flex',gap:'8px',marginTop:'12px',flexWrap:'wrap'}}>
        <button disabled={busy} onClick={()=>resolve(first.id,true)}>Разрешить повторную смену</button>
        <button disabled={busy} className="secondary" onClick={()=>resolve(first.id,false)}>Отклонить</button>
      </div>
    </div>}

    <ManagerV4 profile={profile}/>
  </>
}
