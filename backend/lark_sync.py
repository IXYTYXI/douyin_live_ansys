"""One-way business projections and retry-safe writes to an independent Feishu Base."""
import hashlib
import json
import math
import os
import subprocess
from datetime import datetime
from zoneinfo import ZoneInfo
from .readiness import metric_gaps

TZ = ZoneInfo('Asia/Shanghai')


def date_text(seconds):
    return datetime.fromtimestamp(seconds, TZ).strftime('%Y-%m-%d %H:%M:%S')


def stats(samples, a, b):
    values = [s['value'] for s in samples if a <= s['t'] < b and
              type(s.get('value')) in (int, float) and math.isfinite(s['value'])]
    return {'有效采样数': len(values), '在线均值': round(sum(values)/len(values), 2) if values else None,
            '在线峰值': max(values) if values else None}


def project(data, public_url):
    sid = data['id']; start = data['startedAtUnix']; duration = data['duration']
    samples = data.get('samples', []); notes = data.get('notes', [])
    summaries = data.get('summaries', [])
    link = public_url.rstrip('/') + '/?session=' + sid
    readiness = data.get('collectionStatus', {}).get('readiness', {})
    whole = next((n.get('fields') or {} for n in reversed(notes) if n['scope'] == 'session'), {})
    whole_ai = next((s.get('fields') or {} for s in summaries if not data.get('live') and
                     s['start'] == 0 and abs(s['end']-duration) < .001 and s['status'] == 'done'), {})
    reasons = list(readiness.get('reasons', []))
    if metric_gaps(samples, 0, duration): reasons.append('人数缺失或尚未上传')
    if not data.get('collectorConfirmed'): reasons.append('采集结束尚未核验')
    row = {'直播场次': data['teacher'] + ' · ' + date_text(start), '同步键': sid,
           '主播': data['teacher'], '开始时间': date_text(start),
           '结束时间': None if data.get('live') else date_text(start+duration),
           '录像时长（分钟）': round(duration/60, 2),
           '处理状态': readiness.get('label', '处理中'),
           '数据完整性': '；'.join(dict.fromkeys(reasons)) or '已入库内容核验完成',
           '复盘状态': '已填写' if whole.get('conclusion') or whole.get('adjustment') else
                        '直播中' if data.get('live') else '待复盘',
           'AI整场结论': whole_ai.get('conclusion') or None, 'AI调整建议': whole_ai.get('adjustment') or None,
           '运营整场结论': whole.get('conclusion') or None, '运营调整建议': whole.get('adjustment') or None,
           '复盘链接': link, **stats(samples, 0, duration)}
    periods = []
    # Ten-minute analysis plus explicitly saved custom ranges (e.g. the 30-min UI).
    windows = {(a, min(a+600, duration)) for a in range(0, int(math.ceil(duration)),600)
               if not data.get('live') or a+600 <= duration}
    standard = set(windows)
    windows.update((n['start'],n['end']) for n in notes if n['scope']=='range')
    for a,b in sorted(windows):
        summary = next((s for s in summaries if abs(s['start']-a)<.001 and abs(s['end']-b)<.001), {})
        ai = (summary.get('fields') or {}) if summary.get('status') == 'done' else {}
        human = next((n.get('fields') or {} for n in notes if n['scope']=='range' and
                      abs(n['start']-a)<.001 and abs(n['end']-b)<.001), {})
        periods.append({'时段':data['teacher']+' · '+date_text(start+a),
                        '同步键':sid+':'+str(round(a*1000))+((':'+str(round(b*1000))+':manual') if (a,b) not in standard else ''), '主播':data['teacher'],
                        '开始时间':date_text(start+a),'结束时间':date_text(start+b),
                        'AI主题':ai.get('periodTheme') or None,'AI关键词':'、'.join(ai.get('keywords',[])) or None,
                        'AI结论':ai.get('conclusion') or None,'AI调整建议':ai.get('adjustment') or None,
                        '运营主题':human.get('periodTheme') or None,'运营关键词':'、'.join(human.get('keywords',[])) or None,
                        '运营结论':human.get('conclusion') or None,'运营调整建议':human.get('adjustment') or None,
                        '数据说明':'人数缺失或尚未上传；不推测缺失值' if metric_gaps(samples,a,b) else '该时段已收到人数采样',
                        '总结状态':{'done':'已生成','failed':'失败','processing':'生成中'}.get(summary.get('status'),'等待处理'),
                        '复盘链接':link, **stats(samples,a,b)})
    return row, periods


class DuplicateKey(ValueError): pass


def index_records(page):
    keys = {}; names = page['fields']; key_index = names.index('同步键')
    for rid, values in zip(page['record_id_list'], page['data']):
        key = values[key_index]
        if not isinstance(key, str) or not key: raise ValueError('missing sync key')
        if key in keys: raise DuplicateKey('duplicate sync key')
        keys[key] = rid
    return keys


class LarkCLI:
    def __init__(self, base, executable='lark-cli'):
        self.base = base; self.executable = executable

    def call(self, command, table, *args):
        proc = subprocess.run([self.executable, 'base', command, '--as', 'user',
                               '--base-token', self.base, '--table-id', table, '--format', 'json', *args],
                              capture_output=True, text=True, timeout=90,
                              env={**os.environ,'LARKSUITE_CLI_NO_UPDATE_NOTIFIER':'1'})
        # Raw CLI error messages may contain confidential request data; do not log them.
        if proc.returncode: raise RuntimeError('Feishu command failed: '+command)
        result = json.loads(proc.stdout)
        if not result.get('ok'): raise RuntimeError('Feishu response failed: '+command)
        return result['data']

    def validate_fields(self, table, expected):
        data = self.call('+field-list', table)
        fields = data.get('fields', [])
        names = {f.get('name') for f in fields}
        if not set(expected) <= names: raise ValueError('Feishu schema does not match projection')

    def index(self, table):
        result = {}; offset = 0
        while True:
            page = self.call('+record-list', table, '--field-id', '同步键', '--limit', '200', '--offset', str(offset))
            part = index_records(page)
            if result.keys() & part.keys(): raise DuplicateKey('duplicate sync key across pages')
            result.update(part)
            if not page.get('has_more'): return result
            count = len(page['record_id_list'])
            if not count: raise RuntimeError('empty pagination page')
            offset += count

    def create(self, table, rows):
        names = list(rows[0])
        data = self.call('+record-batch-create', table, '--json', json.dumps(
            {'fields': names, 'rows': [[r.get(n) for n in names] for r in rows]}, ensure_ascii=False))
        if len(data.get('record_id_list', [])) != len(rows): raise RuntimeError('incomplete create acknowledgement')

    def update(self, table, rid, row):
        data = self.call('+record-upsert', table, '--record-id', rid, '--json', json.dumps(row, ensure_ascii=False))
        if data.get('ignored_fields'): raise RuntimeError('ignored writable fields')


def sync_rows(client, table, rows, state, now):
    """Read remote keys before writes, including after ambiguous response failures."""
    keys = client.index(table); new = []; digests = {}
    if len({r['同步键'] for r in rows}) != len(rows): raise DuplicateKey('duplicate source key')
    for row in rows:
        key = row['同步键']; state_key = table+':'+key
        digest = hashlib.sha256(json.dumps(row,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        digests[key] = digest
        value = {**row, '最近同步时间': now}
        if key in keys:
            if state.get(state_key) != digest:
                client.update(table, keys[key], value); state[state_key] = digest
        else: new.append(value)
    for i in range(0,len(new),200):
        batch = new[i:i+200]; client.create(table,batch)
        for row in batch: state[table+':'+row['同步键']] = digests[row['同步键']]
    # Resolve newly-created parent ids from acknowledged remote state, never guessed ids.
    return client.index(table) if new else keys
