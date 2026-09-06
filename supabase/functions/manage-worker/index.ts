import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}})
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
 if(req.method!=='POST')return json({ok:false,error:'Метод не поддерживается'},405)
 try{
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/,'')
  const admin=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}})
  const {data:au}=await admin.auth.getUser(token);if(!au.user)return json({ok:false,error:'Сессия истекла. Войдите заново.'},401)
  const {data:caller}=await admin.from('profiles').select('role,active').eq('id',au.user.id).single();if(caller?.role!=='manager'||!caller.active)return json({ok:false,error:'Только начальник цеха может менять рабочих.'},403)
  const b=await req.json(),id=String(b.worker_id||'');if(!id)return json({ok:false,error:'Не выбран рабочий'})
  const {data:old,error:oldErr}=await admin.from('profiles').select('*').eq('id',id).eq('role','worker').single();if(oldErr||!old)return json({ok:false,error:'Рабочий не найден'},404)
  const login=String(b.login??old.login).trim().toLowerCase(),full_name=String(b.full_name??old.full_name).trim(),position=String(b.position??old.position??'').trim(),password=String(b.password||'')
  if(!/^[a-z0-9._-]{3,40}$/.test(login))return json({ok:false,error:'Логин: 3–40 символов латиницей, цифры, точка, дефис или подчёркивание.'})
  if(password&&password.length<6)return json({ok:false,error:'Новый пароль должен быть не короче 6 символов.'})
  if(!full_name)return json({ok:false,error:'Укажите ФИО рабочего.'})
  const duplicate=await admin.from('profiles').select('id').eq('login',login).neq('id',id).maybeSingle();if(duplicate.data)return json({ok:false,error:`Логин ${login} уже занят.`})
  const email=`${login}@ferrum.local`,authPatch:any={email,email_confirm:true,user_metadata:{login,full_name}};if(password)authPatch.password=password
  const {error:authErr}=await admin.auth.admin.updateUserById(id,authPatch);if(authErr)return json({ok:false,error:`Не удалось обновить вход: ${authErr.message}`})
  const breakRaw=String(b.break_group??old.break_group??'general'),break_group=['locksmith_painter_saw','welder_plasma','general'].includes(breakRaw)?breakRaw:'general',rate=Math.max(0,Number(b.base_rate_8h??old.rate_8h??0)||0)
  const patch={login,full_name,job_title:position,position,break_group,shift_start:b.shift_start||old.shift_start,shift_end:b.shift_end||old.shift_end,rate_8h:rate,base_rate_8h:rate,active:b.active===undefined?old.active:Boolean(b.active),updated_at:new Date().toISOString()}
  const {error:pErr}=await admin.from('profiles').update(patch).eq('id',id);if(pErr)return json({ok:false,error:`Профиль не обновлён: ${pErr.message}`})
  await admin.from('audit_log').insert({actor_id:au.user.id,table_name:'profiles',record_id:id,action:'manager_update_worker',new_data:{login,full_name,position,break_group,shift_start:patch.shift_start,shift_end:patch.shift_end,rate_8h:rate,active:patch.active,password_changed:Boolean(password)}})
  return json({ok:true})
 }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},500)}
})
