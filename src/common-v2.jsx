import React,{useEffect,useState} from 'react'
import {supabase} from './supabase'
export const TZ='Asia/Yekaterinburg'
export const STATUS={queued:'В очереди',active:'В работе',stop_requested:'Ждёт НЦ',completed:'Выполнено',blocked_closed:'Закрыто по согласованию',closed_by_manager:'Закрыто НЦ',cancelled:'Отменено'}
export const REASONS=[['no_material','Нет материала'],['no_components','Нет комплектующих'],['no_drawing','Нет чертежа'],['no_tool','Нет инструмента'],['broken_tool','Сломан инструмент'],['waiting_previous','Жду предыдущую операцию'],['manager_decision','Решение НЦ'],['equipment_failure','Поломка оборудования'],['other','Другое']]
export const BREAKS=[['locksmith_painter_saw','Механики / ленточка / маляр'],['welder_plasma','Сварщики / плазма'],['general','Общая']]
export const day=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
export const monthStart=()=>day().slice(0,8)+'01'
export const money=n=>`${Number(n||0).toLocaleString('ru-RU',{maximumFractionDigits:2})} ₽`
export const hours=m=>`${Math.round(Number(m||0)/6)/10} ч`
export const dt=v=>v?new Date(v).toLocaleString('ru-RU',{timeZone:TZ}):'—'
export const hm=v=>String(v||'').slice(0,5)
export function useLive(table,fn,filter){useEffect(()=>{const ch=supabase.channel(`${table}-${Math.random()}`).on('postgres_changes',{event:'*',schema:'public',table,...(filter?{filter}:{})},fn).subscribe();return()=>supabase.removeChannel(ch)},[table,filter])}
export function Header({profile,title}){return <header><div><div className="logo small">ФЕРРУМ</div><div className="muted">{title}</div></div><div className="row"><b>{profile.full_name}</b><button className="ghost" onClick={()=>supabase.auth.signOut()}>Выйти</button></div></header>}
export function Nav({items,value,onChange}){return <nav className="tabs">{items.map(([k,n])=><button key={k} className={value===k?'active':''} onClick={()=>onChange(k)}>{n}</button>)}</nav>}
export function Badge({children,tone='gray'}){return <span className={`badge ${tone}`}>{children}</span>}
export function Field({label,children,wide=false}){return <label className={wide?'wide':''}>{label}{children}</label>}
export function Empty({children}){return <div className="empty">{children}</div>}
export function Timer({startedAt}){const [now,setNow]=useState(Date.now());useEffect(()=>{const i=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(i)},[]);const s=Math.max(0,Math.floor((now-new Date(startedAt).getTime())/1000));return <b className="timer">{String(Math.floor(s/3600)).padStart(2,'0')}:{String(Math.floor(s%3600/60)).padStart(2,'0')}:{String(s%60).padStart(2,'0')}</b>}
export async function compress(file){if(!file?.type?.startsWith('image/'))return file;const img=await createImageBitmap(file),k=Math.min(1,1600/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);return new Promise(r=>c.toBlob(r,'image/jpeg',.82))}
