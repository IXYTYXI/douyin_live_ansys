"""Normalize only the legacy teacher value for systemd's UTF-8 EnvironmentFile."""
import json
import os
from pathlib import Path


def repair(path):
    path=Path(path)
    lines=path.read_text().splitlines()
    for i,line in enumerate(lines):
        if line.startswith('REVIEW_TEACHER='):
            teacher=json.loads(line.split('=',1)[1])
            if not isinstance(teacher,str):raise ValueError('invalid teacher')
            lines[i]='REVIEW_TEACHER='+json.dumps(teacher,ensure_ascii=False)
    updated='\n'.join(lines)+'\n'
    if updated==path.read_text():return False
    temporary=path.with_suffix('.teacher-tmp')
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as stream:stream.write(updated)
    temporary.replace(path)
    return True


if __name__=='__main__':
    print('teacher configuration updated' if repair('/etc/diting-review.env') else 'already normalized')
