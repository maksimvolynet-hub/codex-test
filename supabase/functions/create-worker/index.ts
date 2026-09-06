import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}})

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return json({ok:false,error:'Метод не поддерживается'},405)
  try{
    const supabaseUrl=Deno.env.get('SUPABASE_URL')!
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader=req.headers.get('Authorization')||''
    const token=authHeader.startsWith('Bearer ')?authHeader.slice(7):''
    if(!token)return json({ok:false,error:'Сессия не найдена. Выйдите и войдите в ФЕРРУМ заново.'})
    const admin=createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}})
    const {data:authData,error:authError}=await admin.auth.getUser(token)
    if(authError||!authData.user)return json({ok:false,error:'Сессия истекла. Выйдите и войдите в ФЕРРУМ заново.'})
    const {data:caller}=await admin.from('profiles').select('role,active').eq('id',authData.user.id).single()
    if(caller?.role!=='manager'||!caller.active)return json({ok:false,error:'Изменять рабочих может только начальник цеха.'})

    const body=await req.json().catch(()=>({}))
    const mode=String(body.mode||'create')
    const login=String(body.login||'').trim().toLowerCase()
    const password=String(body.password||'')
    const fullName=String(body.full_name||'').trim()
    const position=String(body.position||'').trim()
    const raw=String(body.break_group||'general')
    const breakGroup=['locksmith_painter_saw','welder_plasma','general'].includes(raw)?raw:raw==='mechanics'?'locksmith_painter_saw':raw==='welders'?'welder_plasma':'general'
    const shiftStart=String(body.shift_start||'08:00')
    const shiftEnd=String(body.shift_end||'17:00')
    const rate=Math.max(0,Number(body.base_rate_8h||0)||0)
    if(!/^[a-z0-9._-]{3,40}$/.test(login))return json({ok:false,error:'Логин: только латиница, цифры, точка, дефис или подчёркивание; 3–40 символов.'})
    if(!fullName)return json({ok:false,error:'Укажите ФИО рабочего.'})

    if(mode==='update'){
      const workerId=String(body.worker_id||'')
      if(!workerId)return json({ok:false,error:'Не выбран рабочий.'})
      const {data:worker}=await admin.from('profiles').select('id,login,role').eq('id',workerId).single()
      if(!worker||worker.role!=='worker')return json({ok:false,error:'Рабочий не найден.'})
      const {data:busyLogin}=await admin.from('profiles').select('id').eq('login',login).neq('id',workerId).maybeSingle()
      if(busyLogin)return json({ok:false,error:`Логин ${login} уже занят.`})
      const authPatch:any={email:`${login}@ferrum.local`,email_confirm:true,user_metadata:{login,full_name:fullName}}
      if(password){if(password.length<6)return json({ok:false,error:'Новый пароль должен быть не короче 6 символов.'});authPatch.password=password}
      const {error:authUpd}=await admin.auth.admin.updateUserById(workerId,authPatch)
      if(authUpd)return json({ok:false,error:`Не удалось обновить вход: ${authUpd.message}`})
      const {error:profileUpd}=await admin.from('profiles').update({login,full_name:fullName,job_title:position,position,break_group:breakGroup,shift_start:shiftStart,shift_end:shiftEnd,rate_8h:rate,base_rate_8h:rate}).eq('id',workerId)
      if(profileUpd)return json({ok:false,error:`Не удалось сохранить профиль: ${profileUpd.message}`})
      return json({ok:true,worker:{id:workerId,login,full_name:fullName}})
    }

    if(password.length<6)return json({ok:false,error:'Пароль должен быть не короче 6 символов.'})
    const {data:existingProfile}=await admin.from('profiles').select('id').eq('login',login).maybeSingle()
    if(existingProfile)return json({ok:false,error:`Логин ${login} уже занят.`})
    const {data:created,error:createError}=await admin.auth.admin.createUser({email:`${login}@ferrum.local`,password,email_confirm:true,user_metadata:{login,full_name:fullName}})
    if(createError)return json({ok:false,error:`Не удалось создать вход рабочего: ${createError.message}`})
    const id=created.user.id
    const {error:profileError}=await admin.from('profiles').insert({id,login,full_name:fullName,role:'worker',job_title:position,position,break_group:breakGroup,shift_start:shiftStart,shift_end:shiftEnd,report_lead_minutes:10,rate_8h:rate,base_rate_8h:rate,status:'working',active:true})
    if(profileError){await admin.auth.admin.deleteUser(id);return json({ok:false,error:`Профиль рабочего не сохранился: ${profileError.message}`})}
    return json({ok:true,worker:{id,login,full_name:fullName}})
  }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)})}
})
