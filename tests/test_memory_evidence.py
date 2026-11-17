import importlib.util,json,sys,tempfile,time,types,unittest
from pathlib import Path
from unittest.mock import patch
from workcontext.long_memory import Store
from workcontext.memory_activity import export
from workcontext.work_evidence import files_changed,lark_changed
from datetime import datetime,timezone

class Evidence(unittest.TestCase):
 def test_file_inventory_excludes_dependencies_and_symlink_escape(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t)/'work';root.mkdir();(root/'note.md').write_text('work')
   dep=root/'node_modules';dep.mkdir();(dep/'noise').write_text('noise')
   outside=Path(t)/'private';outside.mkdir();(outside/'secret').write_text('secret');(root/'escape').symlink_to(outside,target_is_directory=True)
   result=files_changed(root,time.time()-30,time.time()+30)
   self.assertEqual([r['path'] for r in result['files']],['note.md'])
 def test_lark_paginates_and_reports_failure_without_empty_success(self):
  start=datetime(2026,11,6,tzinfo=timezone.utc)
  pages=[{'ok':True,'data':{'has_more':True,'page_token':'next','results':[{'title_highlighted':'A','result_meta':{}}]}},{'ok':True,'data':{'has_more':False,'results':[{'title_highlighted':'B','result_meta':{}}]}}]
  with patch('workcontext.work_evidence.subprocess.run',side_effect=[types.SimpleNamespace(returncode=0,stdout=json.dumps(p)) for p in pages]) as run:
   r=lark_changed('lark-cli',start,start);self.assertEqual(len(r['documents']),2);self.assertEqual(r['status'],'ok');self.assertIn('--page-token',run.call_args[0][0])
  with patch('workcontext.work_evidence.subprocess.run',return_value=types.SimpleNamespace(returncode=1,stdout='{"ok":false,"error":{"subtype":"expired"}}')):
   self.assertEqual(lark_changed('lark-cli',start,start)['status'],'unavailable')
 def test_native_turn_timestamp_is_present_and_retry_is_idempotent(self):
  fake=types.ModuleType('agent.memory_provider');fake.MemoryProvider=object;fake.is_trivial_prompt=lambda _:False
  with patch.dict(sys.modules,{'agent':types.ModuleType('agent'),'agent.memory_provider':fake}),tempfile.TemporaryDirectory() as t:
   file=Path(__file__).resolve().parents[1]/'integrations/hermes/workcontext-memory/__init__.py'
   spec=importlib.util.spec_from_file_location('test_provider',file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
   p=module.WorkContextMemoryProvider();p._store=Store(Path(t)/'memory.sqlite');p._session='test'
   p.sync_turn('task','result');p.sync_turn('task','result')
   self.assertEqual(p._store.stats()['records'],1)
   day=datetime.now(timezone.utc).astimezone(__import__('zoneinfo').ZoneInfo('Asia/Shanghai')).date().isoformat()
   output=Path(t)/'day.json';result=export(p._store.path,day,output)
   self.assertEqual(result['total'],1);self.assertEqual(result['undated_records'],0)
   self.assertEqual(output.stat().st_mode & 0o777,0o600)
