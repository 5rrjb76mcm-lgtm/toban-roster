#!/usr/bin/env python3
"""公開前点検の回帰試験。架空データだけの一時 Git リポジトリを使い、外部通信はしない。

組み立ては空の成功するスクリプトに置き換え、点検の検出・終了状態・伏字を試す。
PUSH=1 は履歴を読む点検オプション。実際の push や remote の設定は行わない。
"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
FAKE_TOKEN = "gh" + "p_" + "FictionalTokenForRegression123456"
FAKE_HOME = "/Us" + "ers/FictionalProfile/fixture"
FAKE_NAME = "架空検証職員XYZ"


class PrepublishCheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="toban_prepublish_")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.env = dict(os.environ)
        for key in ("PUBLISH", "PUSH", "FRESH", "FULL", "ARTIFACT", "TAGS", "TOBAN_REAL_NAMES", "TOBAN_PROD_DIR", "TOBAN_PROD_EXCLUDE"):
            self.env.pop(key, None)
        self.env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
                        GIT_AUTHOR_NAME="Fictional Test", GIT_COMMITTER_NAME="Fictional Test",
                        GIT_AUTHOR_EMAIL="test@example.invalid", GIT_COMMITTER_EMAIL="test@example.invalid")
        self.git("init", "-q", "--initial-branch=main")
        self.write(".gitignore", "tools/\n")
        self.write("LICENSE", "Synthetic test license\n")
        self.write("webapp/data/rules.json", '{"doctors":[{"name":"FictionalSample"}]}\n')
        self.write("webapp/build.py", "# The fixture tests the checker, not the build.\n")
        for name in ("prepublish_check.sh", "private_paths.py"):
            self.write("tools/" + name, (HERE / name).read_text(encoding="utf-8"))
        python = self.repo / "tools/.venv/bin/python"
        python.parent.mkdir(parents=True)
        python.symlink_to(sys.executable)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "synthetic fixture")

    def write(self, relative, text):
        path = self.repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def git(self, *args, input=None):
        return subprocess.run(["git", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false",
                               "-c", "core.hooksPath=" + os.devnull, *args], cwd=self.repo, env=self.env,
                              input=input, capture_output=True, text=True, check=True).stdout.strip()

    def check(self, **options):
        return subprocess.run(["sh", "tools/prepublish_check.sh"], cwd=self.repo,
                              env=dict(self.env, **options), capture_output=True, text=True)

    def rejected_without_values(self, result, label, *values):
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, 1, output)
        self.assertIn("NG  " + label, output)
        self.assertNotIn("実施した検査は通過", output)
        for value in values:
            self.assertNotIn(value, output)

    def test_clean_history_without_roster_passes_with_skip(self):
        result = self.check(PUSH="1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("実施した検査は通過（省略: 名簿の検査、試験一式）", result.stdout)

    def test_clean_tag_without_roster_passes(self):
        self.git("tag", "-a", "fixture", "-m", "synthetic annotation")
        result = self.check(PUSH="1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_commit_token_without_roster_is_rejected(self):
        self.git("commit", "-q", "--allow-empty", "-m", FAKE_TOKEN)
        self.rejected_without_values(self.check(PUSH="1"), "コミット", FAKE_TOKEN)

    def test_commit_home_without_roster_is_rejected(self):
        self.git("commit", "-q", "--allow-empty", "-m", FAKE_HOME)
        self.rejected_without_values(self.check(PUSH="1"), "コミット", FAKE_HOME)

    def test_tag_annotation_token_without_roster_is_rejected(self):
        self.git("tag", "-a", "fixture", "-m", FAKE_TOKEN)
        self.rejected_without_values(self.check(PUSH="1"), "タグ", FAKE_TOKEN)

    def test_explicit_tag_home_without_roster_is_rejected(self):
        self.git("tag", "-a", "fixture", "-m", FAKE_HOME)
        self.rejected_without_values(self.check(TAGS="fixture"), "タグ", FAKE_HOME)

    def test_tag_name_token_without_roster_is_rejected(self):
        self.git("tag", "-a", FAKE_TOKEN, "-m", "synthetic annotation")
        self.rejected_without_values(self.check(PUSH="1"), "タグ", FAKE_TOKEN)

    def test_missing_tag_without_roster_is_rejected(self):
        self.rejected_without_values(self.check(TAGS="missing-fixture"), "タグ", "missing-fixture")

    def test_tag_outside_head_without_roster_is_rejected(self):
        target = self.git("commit-tree", self.git("rev-parse", "HEAD^{tree}"), input="synthetic separate history\n")
        self.git("tag", "-a", "fixture", target, "-m", "synthetic annotation")
        self.rejected_without_values(self.check(PUSH="1"), "タグ")

    def test_commit_name_with_roster_is_still_rejected(self):
        names = self.root / "names.txt"
        names.write_text(FAKE_NAME + "\n", encoding="utf-8")
        self.git("commit", "-q", "--allow-empty", "-m", FAKE_NAME)
        self.rejected_without_values(self.check(PUBLISH="1", PUSH="1", TOBAN_REAL_NAMES=str(names)), "コミット", FAKE_NAME)

    def test_token_with_only_exempt_sample_names_is_rejected(self):
        names = self.root / "names.txt"
        names.write_text("FictionalSample\n", encoding="utf-8")
        self.git("commit", "-q", "--allow-empty", "-m", FAKE_TOKEN)
        self.rejected_without_values(self.check(PUBLISH="1", PUSH="1", TOBAN_REAL_NAMES=str(names)), "コミット", FAKE_TOKEN)

    def test_tracked_token_is_still_rejected(self):
        self.write("fixture.txt", FAKE_TOKEN)
        self.git("add", "fixture.txt")
        self.git("commit", "-q", "-m", "synthetic token fixture")
        self.rejected_without_values(self.check(PUSH="1"), "トークン", FAKE_TOKEN)


if __name__ == "__main__":
    unittest.main()
