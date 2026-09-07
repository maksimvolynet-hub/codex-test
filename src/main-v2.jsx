import React,{useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {supabase} from './supabase'
import {Manager} from './manager-v5'
import {Worker} from './worker-v5'
import './v2.css'

const PROJECT_HEALTH='https://spbmkixnldxnttcmutaq.supabase.co/auth/v1/health'

function Login(){
  const [u,setU]=useState(''),[p,setP]=useState(''),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false)

  async function checkConnection(){
    const controller=new AbortController()
    const timer=setTimeout(()=>controller.abort(),7000)
    try{
      const r=await fetch(PROJECT_HEALTH,{signal:controller.signal,cache:'no-store'})
      clearTimeout(timer)
      if(r.ok){setMsg('Связь с сервером есть. Если вход не проходит — проверьте раскладку пароля и попробуйте в Chrome.')}
      else setMsg(`Сервер доступен, но вернул ошибку ${r.status}.`)
    }catch(e){
      clearTimeout(timer)
      setMsg('Телефон не может связаться с сервером ФЕРРУМ (Supabase). Попробуйте Chrome и переключите мобильный интернет/Wi‑Fi. VPN не должен быть обязательным.')
    }
  }

  async function go(e){
    e.preventDefault();setBusy(true);setMsg('')
    let email=u.trim();if(!email.includes('@'))email=email.toLowerCase()+'@ferrum.local'
    try{
      const {error}=await supabase.auth.signInWithPassword({email,password:p})
      if(error){
        const text=String(error.message||'').toLowerCase()
        if(text.includes('fetch')||text.includes('network')||text.includes('failed')){
          setMsg('Нет связи с сервером авторизации. Логин и пароль могут быть правильными. Нажмите «Проверить связь».')
        }else if(text.includes('invalid login credentials')){
          setMsg('Сервер ответил: неверный логин или пароль. Проверьте раскладку клавиатуры и регистр пароля.')
        }else{
          setMsg(`Ошибка входа: ${error.message}`)
        }
      }
    }catch(e){
      setMsg('Телефон не смог подключиться к серверу авторизации. Нажмите «Проверить связь».')
    }finally{setBusy(false)}
  }

  return <div className="auth"><form className="auth-card" onSubmit={go}><div className="logo">ФЕРРУМ</div><div className="muted">Производство</div><label>Логин или e-mail<input value={u} onChange={e=>setU(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck="false" required/></label><label>Пароль<input type="password" value={p} onChange={e=>setP(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck="false" required/></label>{msg&&<div className="error">{msg}</div>}<button disabled={busy}>{busy?'Входим…':'Войти'}</button><button type="button" className="secondary" onClick={checkConnection}>Проверить связь</button></form></div>
}

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
