import json,subprocess,tempfile,unittest
from pathlib import Path
SCRIPT=Path(__file__).with_name('measure-base.py')
class LeanBaseGate(unittest.TestCase):
 def test_clean_and_contaminated_whole_tree(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)/'SpecOps.app';root.mkdir();output=Path(tmp)/'inventory.json'
   for name in ['Contents/Info.plist','Contents/MacOS/spec-ops','Contents/Resources/agent-host/index.js','Contents/Resources/icon.icns']:
    p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'fixture')
   def run():return subprocess.run(['python3',str(SCRIPT),'--app',str(root),'--output',str(output)],stdout=subprocess.PIPE,stderr=subprocess.PIPE).returncode
   self.assertEqual(run(),0)
   for name in ['Contents/Frameworks/node','Contents/Helpers/codex','Contents/Resources/claude/native']:
    p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(bytes.fromhex('cffaedfe'))
    self.assertNotEqual(run(),0);self.assertTrue(any(name in e for e in json.loads(output.read_text())['errors']));p.unlink()
   p=root/'Contents/Resources/icon.icns'
   with p.open('wb') as f:f.truncate(83886081)
   self.assertNotEqual(run(),0);self.assertIn('Unpacked budget exceeded',json.loads(output.read_text())['errors'])
if __name__=='__main__':unittest.main()
