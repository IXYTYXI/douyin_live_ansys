"""Install/remove a narrow signed-media test route in an existing TLS vhost.
Run only on an explicitly authorized server after pulling the reviewed commit.
"""
import argparse
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('vhost', type=Path)
parser.add_argument('--remove', action='store_true')
args = parser.parse_args()
path = args.vhost.resolve(strict=True)
old = path.read_text()
marker = '# BEGIN DITING TEST AUDIO\n'
end = '# END DITING TEST AUDIO\n'
if marker in old:
    a = old.index(marker)
    b = old.index(end, a) + len(end)
    updated = old[:a] + old[b:]
else:
    updated = old
if not args.remove:
    needle = '    client_max_body_size '
    if updated.count(needle) != 1:
        raise SystemExit('Expected exactly one insertion point; refusing ambiguous vhost')
    pos = updated.index(needle)
    snippet = Path(__file__).with_name('test-audio-location.conf').read_text()
    updated = updated[:pos] + marker + snippet + end + updated[pos:]
if updated != old:
    backup = path.with_name(path.name + '.diting-backup')
    if not backup.exists():
        backup.write_text(old)
    path.write_text(updated)
    try:
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    except Exception:
        path.write_text(old)
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
        raise
print('Test audio route removed' if args.remove else 'Test audio route installed')
