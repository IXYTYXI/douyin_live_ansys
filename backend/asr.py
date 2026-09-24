"""Company Qwen adapter matching tbjdasr.ailab/codex/obs-asr-backend.
No endpoint or credentials are bundled. Raw provider timestamps are not guessed.
"""
import json
import math
import urllib.request
import urllib.error
import time
import threading
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime


class ASRError(Exception):
    def __init__(self, message, retryable=True, retry_after=None):
        super().__init__(message)
        self.retryable, self.retry_after = retryable, retry_after


def retry_seconds(value):
    try:
        seconds = float(value)
        return max(0, seconds) if math.isfinite(seconds) else 30
    except (TypeError, ValueError):
        try:
            return max(0, (parsedate_to_datetime(value)-datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return 30


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class CompanyASR:
    def __init__(self, url, host='', uid='diting-test', bearer='', requests_per_minute=60):
        if not url.startswith(('https://', 'http://')):
            raise ValueError('configure COMPANY_ASR_URL')
        self.url, self.host, self.uid, self.bearer = url.rstrip('/'), host, uid, bearer
        if not 6 <= requests_per_minute <= 6000:
            raise ValueError('ASR_REQUESTS_PER_MINUTE must be 6..6000')
        self.interval = 60 / requests_per_minute
        self.lock, self.next_request = threading.Lock(), 0.0
        self.http = urllib.request.build_opener(NoRedirect)

    def post(self, route, task_id, body=None):
        headers = {'Content-Type': 'application/json', 'X-Api-Request-Id': task_id}
        if self.host:
            headers['Host'] = self.host
        if self.bearer:
            headers['Authorization'] = 'Bearer ' + self.bearer
        request = urllib.request.Request(self.url + '/asr/v1/qwen3/' + route,
                                         data=json.dumps(body).encode(), headers=headers, method='POST')
        with self.lock:
            time.sleep(max(0, self.next_request-time.monotonic()))
            self.next_request = time.monotonic()+self.interval
        try:
            with self.http.open(request, timeout=30) as response:
                data = json.loads(response.read(4 * 1024 * 1024))
                return str(response.headers.get('X-Api-Status-Code') or data.get('code', '')), data
        except urllib.error.HTTPError as error:
            status = error.code
            retry_after = retry_seconds(error.headers.get('Retry-After')) if status in (429,503) else None
            error.close()
            raise ASRError(f'HTTP {status}', retryable=status in (408,429) or status>=500,
                           retry_after=retry_after) from None

    def submit(self, task_id, audio_url):
        code, _ = self.post('submit', task_id, {'user': {'uid': self.uid},
                            'audio': {'url': audio_url}, 'request': {'model_name': 'qwen3'}})
        if code != '20000000':
            raise ASRError('ASR submit rejected', retryable=code.startswith('5') and code != '55000031')

    def poll(self, task_id):
        code, _ = self.post('query', task_id)
        if code in ('20000001', '20000002'):
            return None
        if code != '20000000':
            raise ASRError('ASR query rejected', retryable=code.startswith('5') and code != '55000031')
        code, data = self.post('result', task_id)
        result = data.get('result', {})
        if code not in ('', '20000000') or not isinstance(result, dict) or not isinstance(result.get('text'), str):
            raise ValueError('ASR result is invalid')
        return {'text':result['text'], 'utterances':result.get('utterances', []), 'audio_info':data.get('audio_info', {})}
