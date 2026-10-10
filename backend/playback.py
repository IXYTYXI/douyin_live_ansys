"""Prepare immutable fast-start MP4 copies without transcoding or changing ASR inputs."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time


def playback_name(name):
    if not re.fullmatch(r'[a-f0-9]{64}\.(mp4|mov)', name):
        raise ValueError('unsupported recording name')
    return hashlib.sha256(('faststart-v1:' + name).encode()).hexdigest() + '.mp4'


def playback_media(root, name):
    try:
        cached = Path(root) / 'media' / playback_name(name)
    except ValueError:
        return name
    return cached.name if cached.is_file() and not cached.is_symlink() else name


def prepare_playback(root, name):
    folder = Path(root) / 'media'
    target = folder / playback_name(name)
    source = folder / name
    if source.is_symlink() or not source.is_file():
        raise ValueError('recording unavailable')
    if target.is_symlink():
        raise ValueError('invalid playback target')
    if target.is_file():
        return target
    if shutil.disk_usage(folder).free < source.stat().st_size * 2 + 64 * 1024 * 1024:
        raise OSError('insufficient space for playback copy')
    fd, temporary = tempfile.mkstemp(prefix='.playback-', suffix='.mp4', dir=folder)
    os.close(fd)
    try:
        subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                        '-i', str(source), '-map', '0:v:0?', '-map', '0:a:0?',
                        '-c', 'copy', '-movflags', '+faststart', temporary],
                       check=True, capture_output=True, timeout=300)
        if Path(temporary).stat().st_size == 0:
            raise ValueError('empty playback copy')
        os.chmod(temporary, 0o640)
        os.replace(temporary, target)
        return target
    finally:
        Path(temporary).unlink(missing_ok=True)


def cycle(root, database_url):
    import psycopg
    prepared = failed = 0
    with psycopg.connect(database_url, connect_timeout=10) as db:
        if not db.execute("SELECT pg_try_advisory_lock(hashtext('diting-playback-faststart-v1'))").fetchone()[0]:
            return 0, 0
        # Only committed recording rows are eligible; never read MediaMTX's growing files.
        rows = db.execute("SELECT media FROM diting_asr_douyin_live.recordings UNION SELECT media FROM diting_asr_douyin_recording_test.recordings").fetchall()
        for (name,) in rows:
            if not name.endswith(('.mp4', '.mov')) or playback_media(root, name) != name:
                continue
            try:
                prepare_playback(root, name)
                prepared += 1
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                failed += 1
                print('Playback preparation failed:', type(error).__name__, flush=True)
    return prepared, failed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    while True:
        try:
            prepared, failed = cycle(os.environ['DATA_DIR'], os.environ['REVIEW_DATABASE_URL'])
            if prepared or failed:
                print(f'Playback prepared={prepared} failed={failed}', flush=True)
        except Exception as error:
            print('Playback cycle failed:', type(error).__name__, flush=True)
            if args.once:
                raise SystemExit(1)
        if args.once:
            raise SystemExit(1 if failed else 0)
        time.sleep(30)


if __name__ == '__main__':
    main()
