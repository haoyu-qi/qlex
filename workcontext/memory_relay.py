"""Incremental, scoped MacBook work-log relay with a durable private outbox."""
import argparse,hashlib,json,os,sqlite3,time
from contextlib import closing
from pathlib import Path
from datetime import datetime,timezone
from . import antigravity_logs
from .service import canonical,load
from .source_logs import eligible,records
from .long_memory import clean
from .memory_client import api

IGNORE={'reasoning','reasoning_content','reasoning_details','encrypted_content','system_prompt','api_content','arguments','output','tool_response','tool_input','tool_calls'}

def dsh_model_message(raw):
    if raw.get('type')!='assistant/message' or not isinstance(raw.get('data'),dict):
        return None
    message=raw['data'].get('message',raw['data'])
    if not isinstance(message,dict):
        return None
    source=message.get('source')
    if message.get('role')=='assistant' and isinstance(source,dict) and source.get('kind')=='model':
        return message
    return None

def occurred_from(raw):
    for key in ['timestamp','createdAt','time']:
        value=raw.get(key)
        if value is None or value=='':continue
        try:
            if isinstance(value,(int,float)) or str(value).replace('.','',1).isdigit():
                value=float(value)
                if value>100000000000:value/=1000
                stamp=datetime.fromtimestamp(value,timezone.utc)
            else:
                stamp=datetime.fromisoformat(str(value).replace('Z','+00:00'))
                if stamp.tzinfo is None:continue
            return stamp.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
        except (ValueError,OverflowError,OSError):continue
    return ''

def text_from(raw):
    # DSH envelopes also contain request schemas and tool output text.
    model=dsh_model_message(raw)
    if model is not None:
        content=model.get('content')
        if isinstance(content,str):return clean(content)[:8000]
        if not isinstance(content,list):return ''
        parts=[part['text'] for part in content if isinstance(part,dict) and
               part.get('type')=='text' and isinstance(part.get('text'),str)]
        return clean('\n'.join(dict.fromkeys(parts)))[:8000]
    if '/' in str(raw.get('type','')):
        kind=raw['type'];data=raw.get('data',{})
        if not isinstance(data,dict):return ''
        if kind=='tool/call':return 'Tool activity: '+str(data.get('name','unknown'))
        if kind not in ['user/message','assistant/message']:return ''
        raw=data.get('message',data)
        if not isinstance(raw,dict):return ''
        source=raw.get('source',{})
        if isinstance(source,dict) and source.get('kind') not in [None,'user']:return ''
    parts=[]
    def walk(value,depth=0):
        if depth>9:return
        if isinstance(value,dict):
            role=value.get('role');kind=str(value.get('type','')).lower()
            if role in ['system','developer','tool'] or value.get('channel')=='analysis' or 'reasoning' in kind or 'analysis' in kind or kind in ['function_call_output','tool_result']:return
            for key,v in value.items():
                if key in IGNORE:continue
                if isinstance(v,str) and key in ['text','content','message','response','summary'] and v.strip():parts.append(v)
                elif isinstance(v,(dict,list)):walk(v,depth+1)
        elif isinstance(value,list):
            for v in value:walk(v,depth+1)
    walk(raw);text=clean('\n'.join(dict.fromkeys(parts)))
    if not text:
        name=raw.get('tool_name') or (raw.get('payload') or {}).get('name') if isinstance(raw.get('payload',{}),dict) else raw.get('tool_name')
        if name:text='Tool activity: '+str(name)
    return text[:8000]

def permitted(c,cwd):
    if not isinstance(cwd,str) or not Path(cwd).is_absolute():return False
    p=Path(cwd).resolve()
    return any(p==Path(root).expanduser().resolve() or Path(root).expanduser().resolve() in p.parents for root in c['allowed_roots'])
def connect(c):
    path=Path(c['outbox']);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700);db=sqlite3.connect(path,timeout=10);db.row_factory=sqlite3.Row
    if os.name!='nt':path.chmod(0o600)
    db.execute('PRAGMA journal_mode=WAL');db.execute('PRAGMA synchronous=FULL')
    db.execute('CREATE TABLE IF NOT EXISTS checkpoints (path TEXT PRIMARY KEY, signature TEXT, ordinal INTEGER, session TEXT, cwd TEXT, complete INTEGER)')
    db.execute('CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, body TEXT, state TEXT DEFAULT \'pending\')');db.commit();return db

def scan(config):
    c=load(config) if not isinstance(config,dict) else config;count=0;errors=[]
    with closing(connect(c)) as db,db:
        for source in c['sources']:
            root=Path(source['path']).expanduser()
            format=source.get('format','jsonl')
            is_antigravity=format=='antigravity-sqlite'
            is_dsh=source['agent']=='dsh'
            processed=0
            try:
                if not root.exists():
                    errors.append({'source':source['agent'],'error':'source_missing'})
                    continue
                session_dirs={}
                candidates=eligible(root,format)
                if is_antigravity:
                    session_dirs=antigravity_logs.workspaces(root)
                    candidates=[p for p in candidates if permitted(c,session_dirs.get(p.stem))]
                elif format=='hermes-sqlite':
                    with closing(sqlite3.connect(root.resolve().as_uri()+'?mode=ro',uri=True)) as native:
                        session_dirs=dict(native.execute('SELECT id,cwd FROM sessions'))
                candidates.sort(key=lambda p:p.stat().st_mtime_ns,reverse=True)
            except (OSError,ValueError,sqlite3.Error) as error:
                errors.append({'source':source['agent'],'error':type(error).__name__})
                continue
            for path in candidates:
                if processed>=c.get('files_per_source',2):break
                try:
                    old=db.execute('SELECT * FROM checkpoints WHERE path=?',(str(path),)).fetchone()
                    cwd=old['cwd'] if old else None
                    last=old['ordinal'] if old else 0
                    session=old['session'] if old else path.stem
                    backfill=False
                    if is_antigravity:
                        cwd=session_dirs[path.stem]
                        signature=canonical([antigravity_logs.sqlite_signature(path),cwd])
                        # A pending step can complete at an earlier index.
                        # Replay the changed database and deduplicate by ID.
                        if old and old['signature']!=signature:last=0
                    else:
                        stat=path.stat()
                        signature=str(stat.st_size)+':'+str(stat.st_mtime_ns)
                        if is_dsh:
                            prefix='dsh-model-v1:'
                            backfill=bool(old and not old['signature'].startswith(prefix))
                            signature=prefix+signature
                    if old and old['signature']==signature and old['complete']:continue
                    processed+=1;seen=0;added=0;complete=1
                    for ordinal,raw in records(path,format,skip_oversized=True):
                        if not isinstance(raw,dict):continue
                        seen=int(ordinal);payload=raw.get('payload') if isinstance(raw.get('payload'),dict) else {}
                        if raw.get('type') in ['session','session_meta']:
                            session=raw.get('id') or payload.get('id') or session;cwd=raw.get('cwd') or payload.get('cwd') or cwd
                        session=raw.get('session_id') or raw.get('sessionId') or session
                        cwd=raw.get('cwd') or payload.get('cwd') or session_dirs.get(session) or cwd
                        if seen<=last and not (backfill and dsh_model_message(raw) is not None):continue
                        text=text_from(raw)
                        if text and permitted(c,cwd):
                            identity=hashlib.sha256(canonical([c['device'],source['agent'],session,str(ordinal),hashlib.sha256(canonical(raw).encode()).hexdigest()]).encode()).hexdigest()
                            row={'id':identity,'device':c['device'],'agent':source['agent'],'session':str(session),'project':Path(cwd).name,'ordinal':str(ordinal),'text':text,'occurred':occurred_from(raw),'metadata':{'cwd':str(Path(cwd).resolve()),'source_path':str(path),'record_ordinal':str(ordinal)}}
                            before=db.total_changes;db.execute('INSERT OR IGNORE INTO outbox(id,body) VALUES (?,?)',(identity,canonical(row)));count+=db.total_changes-before
                        if seen>last:added+=1
                        if added>=c.get('records_per_file',500):complete=0;break
                    if seen<last:seen=0;complete=0
                    db.execute('INSERT OR REPLACE INTO checkpoints VALUES (?,?,?,?,?,?)',(str(path),signature,seen,str(session),cwd,complete));db.commit()
                except Exception as error:db.commit();errors.append({'source':source['agent'],'error':type(error).__name__})
    return {'queued':count,'errors':errors}

def upload(config):
    c=load(config) if not isinstance(config,dict) else config
    with closing(connect(c)) as db,db:
        batch=[]
        size=0
        for row in db.execute("SELECT id,body FROM outbox WHERE state='pending' ORDER BY rowid LIMIT 100"):
            r=json.loads(row['body'])
            if not permitted(c,r['metadata'].get('cwd')):db.execute("UPDATE outbox SET state='blocked' WHERE id=?",(row['id'],));continue
            encoded=len(canonical(r).encode())+1
            if size+encoded>900000:break
            batch.append(r);size+=encoded
        if not batch:return {'delivered':0}
        result=api(c,'/sources/ingest',{'records':batch})
        if not result.get('durable') or set(result.get('ids',[]))!={r['id'] for r in batch}:raise ValueError('durable_ack_missing')
        for r in batch:db.execute("UPDATE outbox SET state='delivered' WHERE id=?",(r['id'],))
        return {'delivered':len(batch)}

def run(config,once=False):
    c=load(config);statusfile=Path(c['outbox']).parent/'relay-health.json'
    while True:
        status={'at':time.time()}
        try:
            status.update(scan(config));status['delivered']=0
            for _ in range(c.get('batches_per_cycle',10)):
                delivered=upload(config)['delivered'];status['delivered']+=delivered
                if not delivered:break
            status['state']='connected'
        except Exception as error:status.update(state='retrying',error=type(error).__name__)
        with closing(connect(c)) as db:status['queue']=dict(db.execute('SELECT state,count(*) FROM outbox GROUP BY state'))
        statusfile.write_text(json.dumps(status,indent=2));statusfile.chmod(0o600)
        if once:return status
        time.sleep(c.get('interval',15))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--once',action='store_true');a=p.parse_args();print(json.dumps(run(a.config,a.once)))
