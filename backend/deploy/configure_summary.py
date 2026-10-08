"""Store explicitly authorized model configuration without logging credentials."""
import json,subprocess,sys
from pathlib import Path
from urllib.parse import urlsplit
settings=json.load(sys.stdin)
if set(settings)!={'SUMMARY_BASE_URL','SUMMARY_MODEL','SUMMARY_API_KEY'}:raise SystemExit('Invalid settings')
if any(not isinstance(v,str) or not v or '\n' in v for v in settings.values()):raise SystemExit('Invalid settings')
url=urlsplit(settings['SUMMARY_BASE_URL'])
if url.scheme!='https' or not url.hostname or url.username or url.password:raise SystemExit('HTTPS URL required')
p=Path('/etc/diting-review.env')
old={k:json.loads(v) for k,v in (line.split('=',1) for line in p.read_text().splitlines() if '=' in line)}
if settings['SUMMARY_MODEL']=='__discover__':settings['SUMMARY_MODEL']=''
old.update(settings)
p.write_text('\n'.join(k+'='+json.dumps(v,ensure_ascii=False) for k,v in old.items())+'\n');p.chmod(0o600)
subprocess.run(['systemctl','restart','diting-review'],check=True)
print('Summary model configured')
