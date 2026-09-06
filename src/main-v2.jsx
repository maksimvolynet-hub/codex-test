import React,{useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {supabase} from './supabase'
import {Manager} from './manager-v5'
import {Worker} from './worker-v5'
import './v2.css'

function Login(){const [u,setU]=useState(''),[p,setP]=useState(''),[msg,setMsg]=useState('');async function go(e){e.preventDefault();let email=u.trim();if(!email.includes('@'))email=email.toLowerCase()+'@ferrum.local';const {error}=await supabase.auth.signInWithPassword({email,password:p});if(error)setMsg('Не удалось войти. Проверьте логин и пароль.')}return <div className="auth"><form className="auth-card" onSubmit={go}><div className="logo">ФЕРРУМ</div><div className="muted">Производство</div><label>Логин или e-mail<input value={u} onChange={e=>setU(e.target.value)} required/></label><label>Пароль<input type="password" value={p} onChange={e=>setP(e.target.value)} required/></label>{msg&&<div className="error">{msg}</div>}<button>Войти</button></form></div>}

function App(){
  const [s,setS]=useState(null),[profile,setProfile]=useState(null),[load,setLoad]=useState(true),[blocked,setBlocked]=useState(false)
  useEffect(()=>{supabase.auth.getSession().then(({data})=>setS(data.session)).finally(()=>setLoad(false));const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,x)=>setS(x));return()=>subscription.unsubscribe()},[])
  useEffect(()=>{
    if(!s?.user){setProfile(null);setBlocked(false);return}
    let live=true
    async function check(){const {data}=await supabase.from('profiles').select('*').eq('id',s.user.id).single();if(!live)return;if(data&&!data.active){setBlocked(true);setProfile(null);await supabase.auth.signOut();return}setBlocked(false);setProfile(data||null)}
    check();const i=setInterval(check,5000);return()=>{live=false;clearInterval(i)}
  },[s])
  if(load)return <div className="auth">Загрузка…</div>
  if(blocked)return <div className="auth"><div className="auth-card"><div className="logo">ФЕРРУМ</div><h3>Доступ закрыт</h3><div className="muted">Учётная запись отключена начальником цеха.</div></div></div>
  if(!s)return <Login/>
  if(!profile)return <div className="auth">Загружаем профиль…</div>
  return profile.role==='manager'?<Manager profile={profile}/>:profile.role==='worker'?<Worker profile={profile}/>:<div className="auth"><div className="auth-card"><h3>Доступ закрыт</h3></div></div>
}

createRoot(document.getElementById('root')).render(<App/>)
