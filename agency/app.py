"""Hosted personal AI + general/sales role agencies (stdlib HTTP server).

Run:
    python -m agency.app          # or: python -m agency
    PORT=8000 python -m agency.app

Binds 0.0.0.0 so Arena's live preview / Vercel-style proxy can reach it.
Browser code uses RELATIVE urls only (no localhost calls).
"""
from __future__ import annotations

import json
import mimetypes
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .agency import Agency

AGENCY = Agency(memory_path=Path(__file__).resolve().parent / ".runtime" / "memory.json")

HTML = r"""<!doctype html>
<html lang="hi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0f17">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<title>Ari • INC AI Agency</title>
<style>
  :root{--bg:#0b0f17;--card:#131a26;--line:#243044;--txt:#e8eef8;--mut:#8ea0bd;--acc:#2ed573;--acc2:#00c2ff}
  *{box-sizing:border-box} body{margin:0;background:radial-gradient(1200px 600px at 20% -10%,#16233a,var(--bg));color:var(--txt);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .wrap{max-width:920px;margin:0 auto;padding:28px 18px 60px}
  h1{font-size:28px;margin:0 0 4px} h1 span{color:var(--acc)}
  .sub{color:var(--mut);margin:0 0 20px}
  .badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
  .badge{background:#162034;border:1px solid var(--line);border-radius:999px;padding:5px 11px;font-size:12px;color:var(--mut)}
  .badge b{color:var(--acc2)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;box-shadow:0 12px 40px #0006;margin-bottom:16px}
  textarea,input{width:100%;background:#0d1420;color:var(--txt);border:1px solid var(--line);border-radius:10px;padding:12px;font:inherit;outline:none}
  textarea{min-height:96px;resize:vertical} input{margin-top:10px}
  textarea:focus,input:focus{border-color:var(--acc2)}
  .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
  button{cursor:pointer;border:0;border-radius:10px;padding:10px 16px;font-weight:600;background:var(--acc);color:#04120a}
  button.alt{background:#1d2a40;color:var(--txt);border:1px solid var(--line)}
  button.blue{background:var(--acc2);color:#04121a}
  pre{white-space:pre-wrap;word-wrap:break-word;background:#0a111c;border:1px solid var(--line);border-radius:12px;padding:16px;min-height:120px;color:#dce8f8;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
  .meta{color:var(--mut);font-size:12px;margin-top:10px}
  a{color:var(--acc2)}
</style>
</head>
<body>
<div class="wrap">
  <h1>🤖 <span>Ari</span> — INC AI Agency</h1>
  <p class="sub">Ari personal AI + 66 general profiles + 56 sales profiles + Level-3 team. Phone browser se use karo; HTTPS par home-screen PWA install ho sakta hai.</p>
  <div class="badges">
    <div class="badge">Personal AI: <b>Ari</b></div>
    <div class="badge">General specialists: <b>__AGENT_COUNT__</b></div>
    <div class="badge">Sales roles: <b>56</b></div>
    <div class="badge">Team: <b>agents/ L3</b></div>
    <div class="badge">Mode: <b>safe / deny</b></div>
  </div>

  <div class="card">
    <textarea id="q" placeholder="Kuch bhi pucho… jaise: '2+2*5 kya hai', 'agency me kitne AI hain', 'INC-BOT ka audit karo'">agency me kitne AI hain?</textarea>
    <input id="goal" placeholder="Bada goal (Team tab ke liye): INC-BOT ka safe audit karo">
    <div class="row">
      <button onclick="ask(false)">Pucho ✅</button>
      <button class="blue" onclick="ask(true)">Panel (5 AI) 🧠</button>
      <button class="alt" onclick="startVoice()">Bolkar pucho 🎙️</button>
      <button class="alt" onclick="speakAnswer()">Jawab suno 🔊</button>
      <button class="alt" id="installApp" onclick="installPwa()">Phone par install / steps 📲</button>
      <button class="alt" onclick="team()">Team se karwao 🚀</button>
      <button class="alt" onclick="loadAgents()">Agents list 📋</button>
      <button class="alt" onclick="health()">Health 💚</button>
    </div>
  </div>

  <div class="card">
    <h2>🏢 Sales Agency — 4 departments / 56 role profiles</h2>
    <p class="sub">Lead Generation → Outreach → Sales Calling → CRM Ops. Sirf user-provided data; sab drafts hain, send/call/CRM write nahi hota.</p>
    <textarea id="salesGoal" placeholder="Sales goal">Qualify opt-in leads for an automation demo</textarea>
    <textarea id="salesLeads" style="margin-top:10px;min-height:130px" placeholder="Consent-safe sample leads (JSON)">[{"id":"sample-1","company":"Example Co","name":"Sam","title":"Operations lead","email":"sam@example.com","source":"user supplied","intent":"exploring automation","email_opt_in":true,"phone_call_opt_in":false,"whatsapp_opt_in":false}]
</textarea>
    <div class="row">
      <button class="blue" onclick="runSales()">Safe sales preview ▶</button>
      <button class="alt" onclick="loadSalesAgents()">Departments / agents 📋</button>
    </div>
    <pre id="salesOut">Sales workflow preview yahan dikhega. Koi email/call/CRM write nahi hota.</pre>
  </div>

  <div class="card">
    <pre id="out">Jawab yahan aayega…</pre>
    <div class="meta" id="meta">Relative API: <code>/api/ask</code> · <code>/api/team</code> · <code>/api/sales/run</code> · <code>/api/health</code></div>
  </div>
</div>
<script>
const out=document.getElementById('out'), meta=document.getElementById('meta');
function show(data,label){ out.textContent = typeof data==='string'?data:JSON.stringify(data,null,2); meta.textContent=label||'done'; }
async function post(path,body){
  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json(); if(!r.ok) throw new Error(d.error||`HTTP ${r.status}`); return d;
}
async function ask(panel){
  const q=document.getElementById('q').value;
  out.textContent='Soch raha hu…';
  try{const d=await post('/api/ask',{question:q,panel:panel,use_model:true});show(d.answer||d, `${d.agent||'Ari'} • ${d.model||'local'} • ${(d.specialists||[]).length} specialist(s)`);}
  catch(e){show('Connection nahi hua: '+e.message+' — server/Internet check karo.','offline / error');}
}
async function team(){
  const g=document.getElementById('goal').value||'INC-BOT ka safe audit karo';
  out.textContent='Agent team chal rahi hai…';
  const d=await post('/api/team',{goal:g});
  show(d.final||d, `Team ${d.run_id||''} • ${d.status||''} • report: ${d.report||''}`);
}
async function loadAgents(){
  const r=await fetch('/api/agents'); const d=await r.json();
  show(d.count+' agents\n'+d.agents.slice(0,12).map(a=>'• '+a.name+' ['+a.category+']').join('\n')+'\n…','/api/agents');
}
async function health(){ const r=await fetch('/api/health'); show(await r.json(),'/api/health'); }
async function loadSalesAgents(){
  const [dr,ar]=await Promise.all([fetch('/api/sales/departments'),fetch('/api/sales/agents')]);
  const d=await dr.json(), a=await ar.json();
  document.getElementById('salesOut').textContent=JSON.stringify({departments:d.departments,role_profiles:a.agents.map(({id,name,department,mission})=>({id,name,department,mission}))},null,2);
}
async function runSales(){
  const goal=document.getElementById('salesGoal').value;
  let leads=[];
  try{leads=JSON.parse(document.getElementById('salesLeads').value||'[]');}
  catch(e){document.getElementById('salesOut').textContent='Lead JSON parse error: '+e;return;}
  const outSales=document.getElementById('salesOut'); outSales.textContent='Consent-safe preview chal raha hai…';
  try{const d=await post('/api/sales/run',{goal,leads,channel:'email'});outSales.textContent=JSON.stringify(d,null,2);}
  catch(e){outSales.textContent='Sales preview error: '+e.message;}
}
let deferredInstall=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;});
async function installPwa(){
  if(!deferredInstall){alert('iPhone: Safari Share → Add to Home Screen. Android: browser menu → Install app / Add to Home screen. HTTPS hosting required.');return;}
  deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall=null;
}
function startVoice(){
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition){alert('Is browser me voice input supported nahi. Text box use karo ya Android Chrome try karo.');return;}
  const rec=new Recognition(); rec.lang='hi-IN'; rec.interimResults=false; rec.maxAlternatives=1;
  rec.onstart=()=>{out.textContent='Sun raha hu…';};
  rec.onresult=e=>{document.getElementById('q').value=e.results[0][0].transcript;ask(false);};
  rec.onerror=e=>{out.textContent='Voice input error: '+e.error;}; rec.start();
}
function speakAnswer(){
  if(!('speechSynthesis' in window)){alert('Is browser me text-to-speech available nahi.');return;}
  window.speechSynthesis.cancel();const utter=new SpeechSynthesisUtterance(out.textContent);utter.lang='hi-IN';window.speechSynthesis.speak(utter);
}
if('serviceWorker' in navigator && window.isSecureContext){window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));}
</script>
</body>
</html>"""


def render_html() -> str:
    return HTML.replace("__AGENT_COUNT__", str(len(AGENCY.registry)))


class Handler(BaseHTTPRequestHandler):
    server_version = "AriAgency/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print("[ari] " + fmt % args, file=sys.stderr, flush=True)

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")

    def _json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _html(self, body: str, status: int = 200) -> None:
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _static(self, path: str) -> None:
        root = (Path(__file__).resolve().parent / "vercel").resolve()
        candidate = (root / path.lstrip("/")).resolve()
        if not candidate.is_relative_to(root) or not candidate.is_file():
            return self._json({"error": "not found", "path": path}, 404)
        data = candidate.read_bytes()
        content_type = {
            ".webmanifest": "application/manifest+json; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".png": "image/png",
        }.get(candidate.suffix.lower(), mimetypes.guess_type(candidate.name)[0] or "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache" if candidate.name in {"service-worker.js", "manifest.webmanifest"} else "public, max-age=86400")
        if candidate.name == "service-worker.js":
            self.send_header("Service-Worker-Allowed", "/")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _body(self) -> dict[str, Any]:

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            data = json.loads(raw.decode("utf-8") or "{}")
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path, query = parsed.path, parse_qs(parsed.query)
        try:
            if path in ("/", "/index.html"):
                return self._html(render_html())
            if path == "/manifest.webmanifest" or path == "/service-worker.js" or path.startswith("/icons/"):
                return self._static(path)
            if path == "/api/health":
                return self._json({
                    "ok": True,
                    "service": "INC AI Agency / Ari",
                    "personal_agent": AGENCY.personal.name,
                    "specialists": len(AGENCY.registry),
                    "sales_role_profiles": len(AGENCY.sales.roster),
                    "sales_departments": AGENCY.sales.departments(),
                    "team_model": AGENCY.lead_team.llm.name,
                    "approval": AGENCY.team_config.approval_mode,
                })
            if path == "/api/agents":
                category = (query.get("category") or [None])[0]
                return self._json({
                    "count": len(AGENCY.list_agents(category)),
                    "categories": AGENCY.categories(),
                    "agents": AGENCY.list_agents(category),
                })
            if path == "/api/sales/departments":
                return self._json({
                    "count": len(AGENCY.sales.roster),
                    "departments": AGENCY.sales_departments(),
                })
            if path == "/api/sales/agents":
                department = (query.get("department") or [None])[0]
                search = (query.get("q") or [None])[0]
                agents = AGENCY.sales_agents(department=department, query=search)
                return self._json({"count": len(agents), "agents": agents})
            if path == "/api/stats":
                return self._json(AGENCY.stats())
            if path == "/api/memory":
                return self._json({"history": AGENCY.history(20), "facts": len(AGENCY.personal.memory["facts"])})
            if path == "/api/ask":
                q = (query.get("q") or [""])[0] or "tum kya kar sakte ho?"
                return self._json(AGENCY.ask(q))
            return self._json({"error": "not found", "path": path}, 404)
        except Exception as exc:
            return self._json({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, 500)

    def do_POST(self) -> None:  # noqa: N802
        path, body = urlparse(self.path).path, self._body()
        try:
            if path == "/api/ask":
                result = AGENCY.consult(body.get("question", "")) if body.get("panel") else AGENCY.ask(
                    body.get("question", ""),
                    user=body.get("user", "ARISE"),
                    use_model=body.get("use_model", True) is not False,
                )
                return self._json(result)
            if path == "/api/team":
                return self._json(AGENCY.delegate(body.get("goal", "")))
            if path == "/api/sales/run":
                try:
                    result = AGENCY.run_sales(
                        body.get("goal", ""),
                        leads=body.get("leads") if "leads" in body else None,
                        channel=body.get("channel", "email"),
                    )
                except (TypeError, ValueError) as exc:
                    return self._json({"ok": False, "error": str(exc)}, 400)
                return self._json(result)
            if path == "/api/hire":
                return self._json(AGENCY.hire(body.get("agent_id", ""), body.get("question", "")))
            if path == "/api/remember":
                return self._json(AGENCY.remember(body.get("fact", "")))
            if path == "/api/forget":
                return self._json(AGENCY.forget())
            return self._json({"error": "not found", "path": path}, 404)
        except Exception as exc:
            return self._json({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, 500)


def serve(host: str = "0.0.0.0", port: int | None = None) -> None:
    port = port or int(os.environ.get("PORT", "8000"))
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    print(f"🤖 Ari hosted at http://{host}:{port} | {len(AGENCY.registry)} general profiles + {len(AGENCY.sales.roster)} sales profiles | /api/ask /api/sales/run", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    serve()
