import unittest
from audio_download import validate_media, TranscriptionError
from server import VIDEO
class EpisodeAudioTest(unittest.TestCase):
    def test_episode_identity_is_exact(self):
        self.assertTrue(VIDEO.fullmatch('bili_ep818207'))
        self.assertFalse(VIDEO.fullmatch('bili_ep0'))
        validate_media({'id':'818207','duration':1710},'bili_ep818207')
        with self.assertRaises(TranscriptionError):
            validate_media({'id':'818208','duration':1710},'bili_ep818207')
