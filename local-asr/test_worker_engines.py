from types import ModuleType, SimpleNamespace
import sys
import unittest
from unittest.mock import patch
from worker import create_transcriber


class WorkerEngineTest(unittest.TestCase):
    def test_faster_whisper_is_cpu_int8_and_normalizes_segments(self):
        module = ModuleType('faster_whisper')
        calls = {}
        class Model:
            def __init__(self, path, **kwargs):
                calls['init'] = (path, kwargs)
            def transcribe(self, audio, **kwargs):
                calls['transcribe'] = kwargs
                item = SimpleNamespace(text=' Hello. ', start=1.0, end=2.5, no_speech_prob=.1, avg_logprob=-.2)
                return iter([item]), SimpleNamespace(language='en')
        module.WhisperModel = Model
        with patch.dict(sys.modules, {'faster_whisper': module}):
            transcribe, label = create_transcriber('faster-whisper', 'model-dir')
            segments = transcribe([0.0])
        self.assertEqual(calls['init'], ('model-dir', {'device':'cpu', 'compute_type':'int8'}))
        self.assertEqual(calls['transcribe']['task'], 'transcribe')
        self.assertEqual(calls['transcribe']['language'], 'en')
        self.assertFalse(calls['transcribe']['condition_on_previous_text'])
        self.assertEqual(segments[0]['text'], ' Hello. ')
        self.assertIn('CPU int8', label)

    def test_unknown_engine_is_rejected(self):
        with self.assertRaisesRegex(ValueError, '不支持'):
            create_transcriber('cloud', 'model')


if __name__ == '__main__':
    unittest.main()
