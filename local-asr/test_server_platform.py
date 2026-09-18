import unittest
from unittest.mock import Mock, patch
import server


class ServerPlatformTest(unittest.TestCase):
    def test_windows_processes_get_a_new_group(self):
        with patch.object(server.os, 'name', 'nt'), \
             patch.object(server.subprocess, 'CREATE_NEW_PROCESS_GROUP', 512, create=True):
            self.assertEqual(server.process_group_options(), {'creationflags':512})

    def test_windows_cancel_targets_only_the_worker_tree(self):
        proc = Mock(pid=4321)
        proc.poll.return_value = None
        proc.wait.return_value = 0
        with patch.object(server.os, 'name', 'nt'), patch.object(server.subprocess, 'run') as run:
            server.terminate_process_tree(proc)
        run.assert_called_once_with(['taskkill','/PID','4321','/T','/F'],
            stdout=server.subprocess.DEVNULL, stderr=server.subprocess.DEVNULL, check=False)
        proc.wait.assert_called_once_with(timeout=4)


if __name__ == '__main__':
    unittest.main()
