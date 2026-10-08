"""Versioned human notes, stored separately from generated summaries."""
import json
from .metrics import MetricsStore, Conflict


def validate_fields(fields, *, keyword_limit=30):
    if not isinstance(fields,dict) or set(fields)-{'periodTheme','keywords','conclusion','adjustment'}:
        raise ValueError('invalid fields')
    for name,limit in [('periodTheme',16),('conclusion',8000),('adjustment',8000)]:
        value=fields.get(name,'')
        if not isinstance(value,str) or len(value)>limit:raise ValueError('invalid '+name)
    tags=fields.get('keywords',[])
    if not isinstance(tags,list) or len(tags)>keyword_limit or any(not isinstance(t,str) or not 0<len(t)<=50 for t in tags):
        raise ValueError('invalid keywords')
    return fields


class ReviewStore(MetricsStore):
    def read_notes(self,session):
        with self.connect() as db:
            rows=db.execute('SELECT scope,start_ms,end_ms,fields,version,updated_at FROM diting_review.notes WHERE session_id=%s',(session,)).fetchall()
        return [{'scope':s,'start':a/1000,'end':b/1000,'fields':f,'version':v,'savedAt':t.isoformat()} for s,a,b,f,v,t in rows]

    def save_notes(self,session,items,duration):
        if not isinstance(items,list) or not 1<=len(items)<=2:raise ValueError('invalid records')
        checked=[]
        for item in items:
            scope=item.get('scope');a=item.get('start');b=item.get('end');version=item.get('version')
            if scope not in ('range','session') or type(a) not in (int,float) or type(b) not in (int,float) or not 0<=a<b<=duration+.001 or type(version)!=int or version<0:
                raise ValueError('invalid range or version')
            if scope=='session' and (a!=0 or abs(b-duration)>.001):raise ValueError('invalid whole session range')
            checked.append((scope,round(a*1000),round(b*1000),validate_fields(item.get('fields')),version))
        if len({(x[0],x[1],x[2]) for x in checked})!=len(checked):raise ValueError('duplicate range')
        with self.connect() as db:
            db.execute('SELECT pg_advisory_xact_lock(hashtext(%s))',('review:'+session,))
            for scope,a,b,fields,version in checked:
                row=db.execute('SELECT version FROM diting_review.notes WHERE session_id=%s AND scope=%s AND start_ms=%s AND end_ms=%s',(session,scope,a,b)).fetchone()
                if (row[0] if row else 0)!=version:raise Conflict('记录已被更新，请刷新后核对再保存')
                db.execute('INSERT INTO diting_review.notes(session_id,scope,start_ms,end_ms,fields,version) VALUES(%s,%s,%s,%s,%s::jsonb,1) ON CONFLICT(session_id,scope,start_ms,end_ms) DO UPDATE SET fields=EXCLUDED.fields,version=diting_review.notes.version+1,updated_at=now()', (session,scope,a,b,json.dumps(fields,ensure_ascii=False)))
        return self.read_notes(session)

    def summaries(self,session):
        with self.connect() as db:
            rows=db.execute('SELECT start_ms,end_ms,status,fields FROM diting_review.summaries WHERE session_id=%s',(session,)).fetchall()
        return [{'start':a/1000,'end':b/1000,'status':s,'fields':f} for a,b,s,f in rows]
