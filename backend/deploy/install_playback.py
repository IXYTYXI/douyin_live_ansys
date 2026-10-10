"""Install only the playback preparation worker; existing ingest/OBS services stay running."""
from pathlib import Path
import subprocess

root=Path(__file__).resolve().parents[2]
unit=Path('/etc/systemd/system/diting-playback.service')
unit.write_text(f"""[Unit]
Description=Diting fast-start playback copies
After=network.target diting-review.service
[Service]
User=diting-review
WorkingDirectory={root}
EnvironmentFile=/etc/diting-review.env
ExecStart={root}/.venv-review/bin/python -m backend.playback
Restart=on-failure
RestartSec=10
Nice=10
IOSchedulingClass=idle
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
""")
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','diting-playback.service'],check=True)
print('Playback worker enabled; reload the review API separately to serve prepared copies.')
