import http.client
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import threading
import unittest
from server import Handler, Jobs, ThreadingHTTPServer, VIDEO, write_json

class ServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.jobs = Jobs(Path(self.temp.name), 'test-model')
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.origins = {'chrome-extension://'+'a'*32}
        self.server.jobs = self.jobs
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(); self.temp.cleanup()
    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=2)
        conn.request(method,path,body,headers or {})
        reply=conn.getresponse(); code=reply.status; data=reply.read(); conn.close(); return code,data
    def auth(self):
        return {'X-Study-Extension':'a'*32,'Origin':'chrome-extension://'+'a'*32,'Content-Type':'application/json'}
    def test_health_allows_only_paired_extension(self):
        self.assertEqual(self.request('GET','/health')[0],403)
        headers=self.auth();headers['Origin']='https://evil.example'
        self.assertEqual(self.request('GET','/health',headers=headers)[0],403)
        code,raw=self.request('GET','/health',headers=self.auth());self.assertEqual(code,200);self.assertTrue(json.loads(raw)['ready'])
    def test_host_and_preflight_are_restricted(self):
        headers=self.auth();headers['Host']='evil.example'
        self.assertEqual(self.request('GET','/health',headers=headers)[0],403)
        self.assertEqual(self.request('OPTIONS','/jobs',headers={'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.request('OPTIONS','/jobs',headers=self.auth())[0],204)
    def test_rejects_urls_paths_and_oversized_requests(self):
        for video in ['https://www.bilibili.com/video/BV1bfLwz1Eu4/','../files','BV1bfLwz1Eu4_p0']:
            self.assertEqual(self.request('POST','/jobs',json.dumps({'videoId':video}),self.auth())[0],400)
        self.assertEqual(self.request('POST','/jobs','x'*5000,self.auth())[0],400)
        self.assertEqual(self.request('GET','/jobs/../../config.json',headers=self.auth())[0],400)
    def test_restart_marks_incomplete_jobs_failed_and_preserves_completed(self):
        for idx,stage in [('1','transcribing'),('2','completed')]:
            folder=Path(self.temp.name)/(idx*32);folder.mkdir();write_json(folder/'status.json',dict(id=idx*32,videoId='BV1bfLwz1Eu4',status=stage))
        jobs=Jobs(Path(self.temp.name),'test-model')
        self.assertEqual(jobs.get('1'*32)['status'],'failed')
        self.assertEqual(jobs.get('2'*32)['status'],'completed')
    def test_cancel_terminates_processing_and_removes_temporary_audio(self):
        job_id='e'*32;folder=Path(self.temp.name)/job_id;folder.mkdir()
        write_json(folder/'status.json',dict(id=job_id,videoId='BV1bfLwz1Eu4',status='transcribing'))
        (folder/'audio.m4a').write_bytes(b'test audio')
        proc=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'],start_new_session=True)
        self.jobs.processes[job_id]=proc
        status=self.jobs.cancel(job_id)
        self.assertEqual(status['status'],'cancelled');self.assertIsNotNone(proc.poll());self.assertFalse((folder/'audio.m4a').exists())
        self.assertEqual(self.jobs.cancel(job_id)['status'],'cancelled')

    def test_running_and_cancelled_jobs_expose_partial_results(self):
        job_id='b'*32;folder=Path(self.temp.name)/job_id;folder.mkdir()
        partial=dict(videoId='BV1bfLwz1Eu4',language='en',source='local-asr',partial=True,revision=1,transcript=[dict(text='Hello.',start=0,duration=1)])
        write_json(folder/'status.json',dict(id=job_id,videoId='BV1bfLwz1Eu4',status='transcribing'))
        write_json(folder/'result.json',partial)
        self.assertTrue(self.jobs.get(job_id)['result']['partial'])
        self.jobs.cancel(job_id)
        self.assertEqual(self.jobs.get(job_id)['result'],partial)

    def test_cancel_is_idempotent_for_completed_job(self):
        job_id='f'*32;folder=Path(self.temp.name)/job_id;folder.mkdir();write_json(folder/'status.json',dict(id=job_id,videoId='BV1bfLwz1Eu4',status='completed'))
        self.assertEqual(self.jobs.cancel(job_id)['status'],'completed')

if __name__=='__main__': unittest.main()
