import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from audio_download import audio_candidates, validate_media, download_audio, TranscriptionError, extractor_class, MAX_BYTES

VID = 'BV1ErJSzTEwC_p4'
NORMAL = 'https://upos.example.bilivideo.com/audio.m4s'
BACKUP = 'https://backup.example.bilivideo.com/audio.m4s'
PEER = 'https://xy.example.mcdn.bilivideo.cn:8082/audio.m4s'

def fmt(url, **kwargs):
    return dict(url=url, ext='m4a', vcodec='none', acodec='mp4a.40.2', format_id='30280', **kwargs)

class AudioTest(unittest.TestCase):
    def test_normal_nodes_first_and_backups_deduplicated(self):
        result = audio_candidates([fmt(NORMAL), fmt(PEER, backup_urls=[BACKUP, NORMAL, 'file:///etc/passwd'])])
        self.assertEqual([f['url'] for f in result], [BACKUP, NORMAL, PEER])
        self.assertLessEqual(len(audio_candidates([fmt(f'https://n{i}.bilivideo.com/audio') for i in range(10)])), 6)

    def test_correct_part_and_limits(self):
        validate_media(dict(id=VID, duration=10800), VID)
        validate_media(dict(id='BV1ErJSzTEwC'), 'BV1ErJSzTEwC')
        with self.assertRaisesRegex(TranscriptionError, '8 小时 9 分钟') as caught:
            validate_media(dict(id=VID, duration=29344.971), VID)
        self.assertEqual(caught.exception.code, 'DURATION_LIMIT')
        with self.assertRaisesRegex(TranscriptionError, '指定分 P'):
            validate_media(dict(id='BV1ErJSzTEwC_p1'), VID)

    def test_extractor_preserves_provided_backup_urls(self):
        from yt_dlp import YoutubeDL
        ie = extractor_class()(YoutubeDL({'quiet': True}))
        formats = ie.extract_formats({'dash': {'audio': [dict(baseUrl=PEER, backupUrl=[NORMAL], mimeType='audio/mp4', codecs='mp4a.40.2', id=30280)]}})
        self.assertEqual(formats[0]['backup_urls'], [NORMAL])

    def run_download(self, info, fail_first=False):
        from yt_dlp.utils import DownloadError
        calls, stages = [], []
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            class FakeDownloader:
                def __init__(self, options): self.options = options
                def __enter__(self): return self
                def __exit__(self, *args): pass
                def add_info_extractor(self, ie): pass
                def extract_info(self, url, **kwargs):
                    self_test.assertTrue(url.endswith('?p=4'))
                    self_test.assertNotIn('playlist_items', self.options)
                    return info
                def process_ie_result(self, data, download):
                    calls.append(data['formats'][0]['url'])
                    if fail_first and len(calls) == 1:
                        (folder/'audio.m4a.part').write_bytes(b'partial')
                        raise DownloadError('connection refused: private diagnostic')
                    self_test.assertFalse((folder/'audio.m4a.part').exists())
                    (folder/'audio.m4a').write_bytes(b'audio')
                    return data
                def prepare_filename(self, info): return str(folder/'audio.m4a')
            self_test = self
            result = download_audio(folder, VID, lambda *args: stages.append(args), FakeDownloader)
            self.assertEqual(result[1].read_bytes(), b'audio')
        return calls

    def test_failed_node_falls_back_and_discards_partial_audio(self):
        calls = self.run_download(dict(id=VID, duration=20, formats=[fmt(PEER, backup_urls=[NORMAL, BACKUP])]), True)
        self.assertEqual(calls, [NORMAL, BACKUP])

    def test_long_video_stops_before_any_download(self):
        with self.assertRaisesRegex(TranscriptionError, '超过单次 3 小时'):
            self.run_download(dict(id=VID, duration=29344, formats=[fmt(NORMAL)]))

    def test_size_limit_is_explained(self):
        with self.assertRaisesRegex(TranscriptionError, '300 MB'):
            self.run_download(dict(id=VID, duration=20, formats=[fmt(NORMAL, filesize=MAX_BYTES+1)]))

if __name__ == '__main__': unittest.main()
