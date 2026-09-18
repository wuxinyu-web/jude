from pathlib import Path
import tempfile
import unittest
from install import platform_backend, runtime_python


class InstallerPlatformTest(unittest.TestCase):
    def test_selects_native_backend(self):
        self.assertEqual(platform_backend('Darwin', 'arm64'), 'mlx')
        self.assertEqual(platform_backend('Windows', 'AMD64'), 'faster-whisper')
        self.assertEqual(platform_backend('Windows', 'x86_64'), 'faster-whisper')

    def test_rejects_unsupported_architecture(self):
        with self.assertRaisesRegex(SystemExit, '64 位'):
            platform_backend('Windows', 'ARM64')
        with self.assertRaises(SystemExit):
            platform_backend('Linux', 'x86_64')

    def test_uses_windows_virtual_environment_layout(self):
        root = Path(tempfile.gettempdir()) / 'runtime'
        self.assertEqual(runtime_python(root, 'Windows'), root / 'Scripts/python.exe')
        self.assertEqual(runtime_python(root, 'Darwin'), root / 'bin/python')


if __name__ == '__main__':
    unittest.main()
