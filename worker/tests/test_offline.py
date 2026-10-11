import os
import subprocess
import sys
import tempfile
import unittest

WORKER = os.path.join(os.path.dirname(__file__), "..")


def run(env_extra, home):
    env = {k: v for k, v in os.environ.items() if k not in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_CACHE", "HF_HOME")}
    env.update(env_extra, HF_HOME=home)
    code = "import offline, os; print(offline.OFFLINE, os.environ.get('HF_HUB_OFFLINE'))"
    return subprocess.run([sys.executable, "-c", code], cwd=WORKER, env=env, capture_output=True, text=True).stdout.split()


def fake_cache(root):
    for m in ("models--sentence-transformers--all-MiniLM-L6-v2", "models--cross-encoder--nli-deberta-v3-small", "models--cross-encoder--ms-marco-MiniLM-L-6-v2"):
        os.makedirs(os.path.join(root, "hub", m, "snapshots"))


class OfflineMode(unittest.TestCase):
    def test_goes_offline_when_both_models_are_cached(self):
        with tempfile.TemporaryDirectory() as home:
            fake_cache(home)
            self.assertEqual(run({}, home), ["True", "1"])

    def test_stays_online_when_a_model_is_missing(self):
        with tempfile.TemporaryDirectory() as home:
            self.assertEqual(run({}, home)[0], "False")

    def test_explicit_setting_wins(self):
        with tempfile.TemporaryDirectory() as home:
            fake_cache(home)
            self.assertEqual(run({"HF_HUB_OFFLINE": "0"}, home)[0], "False")


if __name__ == "__main__":
    unittest.main()
