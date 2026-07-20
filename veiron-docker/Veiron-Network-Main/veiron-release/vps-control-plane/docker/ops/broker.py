from __future__ import annotations
import json, os, secrets, shlex, subprocess
from pathlib import Path
from flask import Flask, jsonify, request
app=Flask(__name__)
WORKSPACE=Path(os.environ['VEIRON_WORKSPACE']).resolve(); COMPOSE_FILE=Path(os.environ.get('VEIRON_COMPOSE_FILE',WORKSPACE/'compose.yaml')); TOKEN_FILE=Path(os.environ.get('BROKER_TOKEN_FILE','/run/secrets/broker_token'))
def token(): return TOKEN_FILE.read_text().strip()
def auth():
 v=request.headers.get('X-Veiron-Broker-Token',''); return bool(v and secrets.compare_digest(v,token()))
def load_env():
 env=os.environ.copy(); p=WORKSPACE/'.env'
 if p.exists():
  for raw in p.read_text().splitlines():
   line=raw.strip()
   if not line or line.startswith('#') or '=' not in line: continue
   k,v=line.split('=',1)
   try: parts=shlex.split(v); env[k]=parts[0] if parts else ''
   except ValueError: env[k]=v.strip().strip("'\"")
 for k in ('VEIRON_HOST_WORKSPACE','VEIRON_HOST_REPO','VEIRON_COMPOSE_FILE'):
  if k in os.environ: env[k]=os.environ[k]
 return env
def cfg(): return load_env()
def compose(*args, profiles=()):
 e=cfg(); cmd=['docker','compose','--env-file',str(WORKSPACE/'.env'),'-f',str(COMPOSE_FILE)]
 if e.get('CLOUDFLARE_MODE','disabled')!='tunnel': cmd += ['-f',str(WORKSPACE/'compose.direct.yaml')]
 for p in profiles: cmd += ['--profile',p]
 return cmd+list(args)
def run(args,timeout=7200,check=True):
 r=subprocess.run(args,cwd=WORKSPACE,env=cfg(),text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
 if check and r.returncode: raise RuntimeError(f"command failed ({r.returncode}): {' '.join(args)}\n{r.stdout}")
 return r.stdout
def profiles():
 e=cfg(); p=['backup']
 if e.get('CLOUDFLARE_MODE')=='tunnel': p.append('cloudflare')
 if e.get('ENABLE_POOL','false').lower()=='true': p.append('pool')
 return p
def deploy():
 e=cfg(); out=[run(compose('config'),120)]
 if e.get('CLOUDFLARE_MODE','disabled')!='disabled': out.append(run([str(WORKSPACE/'scripts/cloudflare-bootstrap.sh')],600))
 # Deliberately build from the checked-out repository. No pull, updater, mutable tag refresh or scheduled image replacement.
 args=('up','-d','--build','--remove-orphans')
 out.append(run(compose(*args,profiles=profiles()),7200)); out.append(run([str(WORKSPACE/'scripts/health-check-docker.sh')],600)); return '\n'.join(out)
def status():
 raw=run(compose('ps','--format','json'),120,False); services=[]
 for line in raw.splitlines():
  try: services.append(json.loads(line))
  except json.JSONDecodeError: pass
 return {'configured':(WORKSPACE/'.env').exists(),'services':services,'raw':raw}
@app.get('/health')
def health(): return jsonify({'ok':True,'service':'veiron-docker-broker'})
@app.post('/v1/action')
def action():
 if not auth(): return jsonify({'error':'unauthorized'}),401
 p=request.get_json(silent=True) or {}; a=str(p.get('action',''))
 try:
  if a=='deploy': return jsonify({'ok':True,'output':deploy()})
  if a=='status': return jsonify({'ok':True,**status()})
  if a=='backup': return jsonify({'ok':True,'output':run([str(WORKSPACE/'scripts/backup-now.sh')])})
  return jsonify({'error':'unsupported action'}),400
 except (RuntimeError,ValueError,subprocess.TimeoutExpired) as ex: return jsonify({'error':f'{type(ex).__name__}: {ex}'}),500
