"""MediaMTX hooks persist completed segments; never inspect a growing recording."""
import json,os,sys,time,uuid
from pathlib import Path
from .live import run_id,segment_stamp


def main():
    run=os.environ['MTX_PATH']
    if not run_id(run):raise ValueError('invalid path')
    root=Path(os.environ['LIVE_INBOX']).resolve()
    folder=root/run;folder.mkdir(parents=True,exist_ok=True)
    kind=sys.argv[1]
    if kind=='segment':
        segment=Path(os.environ['MTX_SEGMENT_PATH']).resolve(strict=True)
        if segment.parent!=folder:raise ValueError('segment outside inbox')
        segment_stamp(segment.name)
        value={'path':str(segment)};target=segment.with_suffix('.ready')
    elif kind in ('ready','stop'):
        target=folder/'state.json';value={'live':kind=='ready','at':time.time()}
    else:raise ValueError('unknown hook')
    temporary=folder/('.event-'+uuid.uuid4().hex)
    temporary.write_text(json.dumps(value));os.replace(temporary,target)


if __name__=='__main__':main()
