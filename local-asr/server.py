"""Loopback-only original-audio transcription service. No cloud audio upload."""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VIDEO = re.compile(r'BV[0-9A-Za-z]{10}(?:_p[1-9][0-9]{0,3})?\Z')
JOB = re.compile(r'[0-9a-f]{32}\Z')
TERMINAL = {'completed', 'failed', 'cancelled'}
MAX_BODY = 4096

def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None

def write_json(path, data):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False))
    tmp.replace(path)

class Jobs:
    def __init__(self, root, model):
        self.root = root
        self.model = model
        self.lock = threading.Lock()
        self.processes = {}
        root.mkdir(parents=True, exist_ok=True)
        # An interrupted process must never be reported as still running after restart.
        for path in root.glob('*/status.json'):
            data = read_json(path)
            if data and JOB.fullmatch(path.parent.name) and time.time()-data.get('createdAt',time.time()) > 7*86400:
                shutil.rmtree(path.parent)
                continue
            if data and data.get('status') not in TERMINAL:
                data.update(status='failed', message='本地服务已重启，请重新转写。')
                write_json(path, data)

    def start(self, video_id):
        if not isinstance(video_id, str) or not VIDEO.fullmatch(video_id):
            raise ValueError('仅支持有效的 B 站 BV 视频和分 P。')
        with self.lock:
            for job_id, proc in self.processes.items():
                if proc.poll() is None:
                    status = self.get(job_id)
                    if status['videoId'] == video_id:
                        return status
                    raise ValueError('已有视频正在转写，请等待完成或先取消。')
            job_id = uuid.uuid4().hex
            folder = self.root / job_id
            folder.mkdir()
            status = dict(id=job_id, videoId=video_id, status='queued', message='准备读取视频原声', progress=0, createdAt=time.time())
            write_json(folder / 'status.json', status)
            log = (folder / 'worker.log').open('wb')
            try:
                proc = subprocess.Popen([sys.executable, str(Path(__file__).with_name('worker.py')),
                    '--folder', str(folder), '--model', self.model], stdout=log, stderr=log, start_new_session=True)
            finally:
                log.close()
            self.processes[job_id] = proc
            return status

    def get(self, job_id):
        if not JOB.fullmatch(job_id):
            raise ValueError('无效的任务编号。')
        status = read_json(self.root / job_id / 'status.json')
        if not status:
            raise ValueError('任务不存在，请重新开始。')
        proc = self.processes.get(job_id)
        if proc and proc.poll() is not None and status['status'] not in TERMINAL:
            status.update(status='failed', message='转写进程已退出，请重试或检查本地服务日志。')
            write_json(self.root / job_id / 'status.json', status)
        if status['status'] == 'completed':
            status['result'] = read_json(self.root / job_id / 'result.json')
        return status

    def cancel(self, job_id):
        with self.lock:
            status = self.get(job_id)
            if status['status'] in TERMINAL:
                return status
            proc = self.processes.get(job_id)
            if proc and proc.poll() is None:
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait(timeout=4)
            status.update(status='cancelled', message='已取消；原字幕和收藏保持不变。')
            write_json(self.root / job_id / 'status.json', status)
            # Only remove this service's own temporary downloaded audio.
            for path in (self.root / job_id).glob('audio*'):
                if path.is_file():
                    path.unlink()
            return status

class Handler(BaseHTTPRequestHandler):
    server_version = 'VideoStudyLocalASR/1'
    def setup(self):
        super().setup()
        self.connection.settimeout(10)
    def log_message(self, *_args):
        pass
    def allowed(self, preflight=False):
        if self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}':
            return False
        origin = self.headers.get('Origin')
        allowed = self.server.origins
        if preflight:
            return origin in allowed
        identity = 'chrome-extension://' + self.headers.get('X-Study-Extension', '')
        return identity in allowed and (origin is None or origin == identity)
    def reply(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        if self.headers.get('Origin') in self.server.origins:
            self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
            self.send_header('Vary', 'Origin')
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_OPTIONS(self):
        if not self.allowed(True):
            return self.reply(403, {'error':'不允许的来源。'})
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Study-Extension')
        self.send_header('Vary', 'Origin')
        self.end_headers()
    def do_GET(self):
        if not self.allowed():
            return self.reply(403, {'error':'只允许配置中的学习扩展访问。'})
        try:
            if self.path == '/health':
                return self.reply(200, {'ready':True,'engine':'Whisper 本地英文转写','modelReady':Path(self.server.jobs.model).is_dir()})
            if self.path.startswith('/jobs/'):
                return self.reply(200, self.server.jobs.get(self.path[6:]))
            self.reply(404, {'error':'接口不存在。'})
        except ValueError as e:
            self.reply(400, {'error':str(e)})
    def do_POST(self):
        if not self.allowed():
            return self.reply(403, {'error':'不允许的来源。'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if self.path != '/jobs' or not 0 < size <= MAX_BODY:
                raise ValueError('请求无效或过大。')
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict) or set(data) != {'videoId'}:
                raise ValueError('请求只能包含视频编号。')
            self.reply(202, self.server.jobs.start(data['videoId']))
        except (ValueError, TypeError) as e:
            self.reply(400, {'error':str(e)})
    def do_DELETE(self):
        if not self.allowed():
            return self.reply(403, {'error':'不允许的来源。'})
        try:
            if not self.path.startswith('/jobs/'):
                raise ValueError('任务地址无效。')
            self.reply(200, self.server.jobs.cancel(self.path[6:]))
        except ValueError as e:
            self.reply(400, {'error':str(e)})

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    config = read_json(args.config)
    if not config or not config.get('extensionIds'):
        raise SystemExit('请先运行本地转写安装脚本。')
    ids = config['extensionIds']
    if any(not re.fullmatch('[a-p]{32}', x) for x in ids):
        raise SystemExit('扩展 ID 无效。')
    server = ThreadingHTTPServer(('127.0.0.1', 8766), Handler)
    server.origins = {'chrome-extension://' + x for x in ids}
    server.jobs = Jobs(args.config.parent / 'jobs', config['model'])
    print('本地原声转写服务已启动：127.0.0.1:8766。返回扩展点击「转写英文原声」。', flush=True)
    def stop(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGHUP, stop)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for job in list(server.jobs.processes):
            server.jobs.cancel(job)
        server.server_close()

if __name__ == '__main__':
    main()
