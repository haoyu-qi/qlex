"""Export a complete local calendar-day evidence bundle, without keyword ranking."""
import argparse,json,os,sqlite3,tempfile
from contextlib import closing
from pathlib import Path
from .long_memory import Store

def export(database,day,output):
    # Freeze pagination so concurrent relay inserts cannot shift page boundaries.
    with tempfile.TemporaryDirectory(prefix='workcontext-activity-') as directory:
        snapshot=Path(directory)/'memory.sqlite'
        with closing(sqlite3.connect(Path(database).expanduser().resolve().as_uri()+'?mode=ro',uri=True)) as source, closing(sqlite3.connect(snapshot)) as destination:source.backup(destination)
        return _export_snapshot(snapshot,day,output)

def _export_snapshot(database,day,output):
    store=Store(database);page=store.activity(day);result={**page,'records':list(page['records'])}
    while page['next_offset'] is not None:
        page=store.activity(day,offset=page['next_offset']);result['records'].extend(page['records'])
    result['next_offset']=None
    result['exported_records']=len(result['records'])
    result['total']=page['total']
    result['sessions']=page['sessions']
    target=Path(output);target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as stream:json.dump(result,stream,ensure_ascii=False,indent=2)
    target.chmod(0o600)
    return {k:v for k,v in result.items() if k!='records'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--database',required=True);p.add_argument('--day',required=True);p.add_argument('--output',required=True)
    a=p.parse_args();print(json.dumps(export(a.database,a.day,a.output),ensure_ascii=False))
