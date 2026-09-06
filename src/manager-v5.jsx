import React,{useEffect,useState} from 'react'
import {supabase} from './supabase'
import {Manager as ManagerV4} from './manager-core-v4'

export function Manager({profile}){
  const [requests,setRequests]=useState([])

  async function loadRequests(){
    const {data,error}=await supabase
      .from('shift_reopen_requests')
      .select('id,reason,created_at,profiles!shift_reopen_requests_worker_id_fkey(full_name)')
      .eq('status','pending')
      .order('created_at',{ascending:true})
    if(!error)setRequests(data||[])
  }

  useEffect(()=>{
    loadRequests()
    const timer=setInterval(loadRequests,4000)
    const channel=supabase
      .channel(`manager-shift-reopen-${profile.id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${profile.id}`},loadRequests)
      .subscribe()
    return()=>{
      clearInterval(timer)
      supabase.removeChannel(channel)
    }
  },[profile.id])

  const first=requests[0]
  return <>
    {requests.length>0&&<div style={{position:'fixed',right:'16px',top:'16px',zIndex:9999,width:'min(430px,calc(100vw - 32px))',background:'#fff7ed',border:'2px solid #f97316',borderRadius:'14px',padding:'14px 16px',boxShadow:'0 10px 30px rgba(0,0,0,.18)'}}>
      <div style={{fontWeight:800,fontSize:'16px',marginBottom:'6px'}}>🔔 Запрос на повторную смену</div>
      <div><b>{first?.profiles?.full_name||'Рабочий'}</b>{requests.length>1?` и ещё ${requests.length-1}`:''}</div>
      <div style={{marginTop:'4px'}}>{first?.reason||'Причина не указана'}</div>
      <div style={{marginTop:'8px',fontSize:'13px',opacity:.75}}>Откройте «Цех сейчас» — там можно разрешить или отклонить повторную смену.</div>
    </div>}
    <ManagerV4 profile={profile}/>
  </>
}
