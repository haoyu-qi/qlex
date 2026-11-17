"""MacBook-local evidence metadata for Mini reports; never copies credentials or files."""
import argparse,json,os,subprocess
from datetime import datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

EXCLUDE={'node_modules','.git','.venv','venv','__pycache__','dist','build','target','.next','.memory','.p1','.p2','.execution','.web','.obsidian','.trash'}

def files_changed(root,start,end):
    root=Path(root).expanduser();rows=[];errors=[]
    if not root.is_dir():return {'status':'unavailable','root':str(root),'files':[]}
    def failed(error):errors.append({'error':type(error).__name__,'errno':getattr(error,'errno',None),'path':str(getattr(error,'filename',''))})
    for directory,dirs,files in os.walk(root,onerror=failed,followlinks=False):
        dirs[:]=[d for d in dirs if d not in EXCLUDE and not d.startswith('.') and not Path(directory,d).is_symlink()]
        for name in files:
            p=Path(directory,name)
            if name.startswith('.') or p.is_symlink():continue
            try:
                stat=p.stat()
                if start<=stat.st_mtime<end:rows.append({'path':str(p.relative_to(root)),'mtime':stat.st_mtime,'bytes':stat.st_size})
            except OSError as error:failed(error)
    return {'status':'partial' if errors else 'ok','root':str(root),'files':rows,'errors':errors,'meaning':'mtime metadata only; not proof of authorship or completion','excluded_directories':sorted(EXCLUDE)}

def lark_changed(cli,start,end):
    rows=[];token=None;seen=set();env={**os.environ,'LARKSUITE_CLI_NO_UPDATE_NOTIFIER':'1','LARKSUITE_CLI_NO_SKILLS_NOTIFIER':'1'}
    for _ in range(100):
        args=[cli,'drive','+search','--as','user','--query','','--edited-since',start.isoformat(),'--edited-until',end.isoformat(),'--page-size','20','--sort','edit_time','--json']
        if token:args+=['--page-token',token]
        try:
            r=subprocess.run(args,capture_output=True,text=True,timeout=45,env=env);response=json.loads(r.stdout)
            if r.returncode or not response.get('ok'):return {'status':'unavailable','error':response.get('error',{}).get('subtype','cli_failed'),'documents':rows}
            data=response['data']
            for row in data.get('results',[]):
                m=row.get('result_meta',{});rows.append({'title':row.get('title_highlighted',''),'url':m.get('url'),'type':m.get('doc_types'),'update_time':m.get('update_time_iso'),'last_editor':m.get('edit_user_name')})
            if not data.get('has_more'):return {'status':'ok','documents':rows,'meaning':'User edited-time search; document body changes require separate verification.'}
            token=data.get('page_token')
            if not token or token in seen:break
            seen.add(token)
        except (OSError,ValueError,subprocess.TimeoutExpired) as error:return {'status':'unavailable','error':type(error).__name__,'documents':rows}
    return {'status':'partial','error':'pagination_incomplete','documents':rows}

def collect(config,day=None):
    start=datetime.fromisoformat(day or datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()).replace(tzinfo=ZoneInfo('Asia/Shanghai'));end=start+timedelta(days=1)
    result={'day':start.date().isoformat(),'device':'macbook','generated_at':datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),'workspaces':[files_changed(root,start.timestamp(),end.timestamp()) for root in config['roots']],'lark':lark_changed(config['lark_cli'],start,end)}
    path=Path(config['output_directory'])/(result['day']+'.json');path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if path.exists():
        previous=json.loads(path.read_text())
        for current in result['workspaces']:
            if current['status']=='ok':continue
            old=next((w for w in previous.get('workspaces',[]) if w.get('root')==current.get('root')),None)
            if old:
                baseline=old.get('last_successful') or ({'observed_at':previous['generated_at'],'files':old['files']} if old['status']=='ok' else None)
                if baseline:current['last_successful']=baseline
    payload=json.dumps(result,ensure_ascii=False,indent=2).encode()
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'wb') as stream:stream.write(payload)
    path.chmod(0o600)
    if config.get('ssh_argv'):
        # Fixed remote destination, independent of payload strings.
        code="import sys,os,json; from pathlib import Path; raw=sys.stdin.buffer.read(); d=json.loads(raw); from datetime import date; name=date.fromisoformat(d['day']).isoformat(); p=Path.home()/'workcontext-memory/state/macbook-evidence'; p.mkdir(parents=True,exist_ok=True,mode=0o700); f=p/(name+'.json'); temp=f.with_suffix('.tmp'); temp.write_bytes(raw); temp.chmod(0o600); temp.replace(f)"
        import shlex
        subprocess.run(config['ssh_argv']+['python3 -c '+shlex.quote(code)],input=payload,check=True,timeout=30,capture_output=True)
    return {'day':result['day'],'workspace_files':[len(w['files']) for w in result['workspaces']],'lark_status':result['lark']['status'],'lark_documents':len(result['lark']['documents']),'published':bool(config.get('ssh_argv'))}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--day');a=p.parse_args();print(json.dumps(collect(json.loads(Path(a.config).read_text()),a.day),ensure_ascii=False))
