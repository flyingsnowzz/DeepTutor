"""Minimal hosted register/login page for personal learners.

The page never sends credentials anywhere except this service's /v1/auth API;
external hosts/skills only receive the returned access token. This is a first
trial-grade page — the JSON API underneath is what production identity
providers will eventually replace.
"""

from __future__ import annotations

HTML = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DeepTutor 账户</title>
<style>
  body{font-family:system-ui,-apple-system,"PingFang SC",sans-serif;background:#f6f7fb;margin:0;padding:48px 16px;color:#1f2430}
  .card{max-width:380px;margin:0 auto;background:#fff;border:1px solid #e6e8f0;border-radius:14px;padding:28px;box-shadow:0 8px 30px rgba(30,40,80,.08)}
  h1{font-size:20px;margin:0 0 4px} p.sub{margin:0 0 20px;color:#6b7180;font-size:13px}
  label{display:block;font-size:13px;color:#4a5067;margin:12px 0 6px}
  input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d6d9e4;border-radius:8px;font-size:14px}
  button{width:100%;margin-top:18px;padding:11px;border:0;border-radius:8px;background:#3457d5;color:#fff;font-size:15px;cursor:pointer}
  button.secondary{background:#eef1fb;color:#3457d5}
  .tabs{display:flex;gap:8px;margin-bottom:8px}
  .tabs button{margin:0;background:#eef1fb}
  .tabs button.active{background:#3457d5;color:#fff}
  #msg{margin-top:14px;font-size:13px;white-space:pre-wrap;word-break:break-all}
  .ok{color:#1a7f4b}.err{color:#c0392b}
  code{background:#f1f3f9;padding:2px 5px;border-radius:4px}
</style>
</head>
<body>
<div class="card">
  <h1>DeepTutor 学习服务</h1>
  <p class="sub">注册或登录后，把访问令牌配置到宿主（WorkBuddy 等）。密码仅发送到本服务。</p>
  <div class="tabs">
    <button id="tab-login" class="active" type="button">登录</button>
    <button id="tab-register" type="button">注册</button>
  </div>
  <label>邮箱</label><input id="email" type="email" autocomplete="username" placeholder="you@example.com">
  <label>密码（至少 8 位）</label><input id="password" type="password" autocomplete="current-password">
  <label style="display:none" id="name-label">昵称（可选）</label><input id="display_name" style="display:none">
  <button id="submit">登录</button>
  <div id="msg"></div>
</div>
<script>
const $=(id)=>document.getElementById(id);
let mode='login';
function setMode(m){mode=m;$('tab-login').classList.toggle('active',m==='login');
  $('tab-register').classList.toggle('active',m==='register');
  $('submit').textContent=m==='login'?'登录':'注册并登录';
  $('name-label').style.display=m==='register'?'block':'none';
  $('display_name').style.display=m==='register'?'block':'none';
  $('msg').textContent='';}
$('tab-login').onclick=()=>setMode('login');
$('tab-register').onclick=()=>setMode('register');
$('submit').onclick=async()=>{
  const msg=$('msg');msg.className='';msg.textContent='请稍候…';
  try{
    const body={email:$('email').value.trim(),password:$('password').value};
    if(mode==='register'){body.display_name=$('display_name').value;
      const r=await fetch('/v1/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const d=await r.json();if(!d.ok)throw new Error(d.error.message);
    }
    const r=await fetch('/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({email:body.email,password:body.password})});
    const d=await r.json();
    if(!d.ok)throw new Error(d.error.message);
    msg.className='ok';
    msg.textContent='登录成功。访问令牌（Authorization: Bearer）：\\n\\n'+d.data.access_token+
      '\\n\\n刷新令牌（保密，30 天）：\\n'+d.data.refresh_token+
      '\\n\\n套餐：'+d.data.plan+'，有效期 '+d.data.expires_in+' 秒';
  }catch(e){msg.className='err';msg.textContent='失败：'+e.message;}
};
</script>
</body>
</html>
"""
