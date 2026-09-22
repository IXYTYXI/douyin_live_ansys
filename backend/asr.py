"""Company Qwen adapter matching tbjdasr.ailab/codex/obs-asr-backend.
No endpoint or credentials are bundled. Raw provider timestamps are not guessed.
"""
import json
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class CompanyASR:
    def __init__(self, url, host='', uid='diting-test', bearer=''):
        if not url.startswith(('https://', 'http://')):
            raise ValueError('configure COMPANY_ASR_URL')
        self.url, self.host, self.uid, self.bearer = url.rstrip('/'), host, uid, bearer
        self.http = urllib.request.build_opener(NoRedirect)

    def post(self, route, task_id, body=None):
        headers = {'Content-Type': 'application/json', 'X-Api-Request-Id': task_id}
        if self.host:
            headers['Host'] = self.host
        if self.bearer:
            headers['Authorization'] = 'Bearer ' + self.bearer
        request = urllib.request.Request(self.url + '/asr/v1/qwen3/' + route,
                                         data=json.dumps(body).encode(), headers=headers, method='POST')
        with self.http.open(request, timeout=30) as response:
            data = json.loads(response.read(4 * 1024 * 1024))
            return str(response.headers.get('X-Api-Status-Code') or data.get('code', '')), data

    def submit(self, task_id, audio_url):
        code, _ = self.post('submit', task_id, {'user': {'uid': self.uid},
                            'audio': {'url': audio_url}, 'request': {'model_name': 'qwen3'}})
        if code != '20000000':
            raise RuntimeError('ASR submit rejected')

    def poll(self, task_id):
        code, _ = self.post('query', task_id)
        if code in ('20000001', '20000002'):
            return None
        if code != '20000000':
            raise RuntimeError('ASR query rejected')
        code, data = self.post('result', task_id)
        result = data.get('result', {})
        if code not in ('', '20000000') or not isinstance(result, dict) or not isinstance(result.get('text'), str):
            raise ValueError('ASR result is invalid')
        return result['text']
