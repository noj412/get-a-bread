"""Regression checks for state loss previously observed during job imports."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

import server


class BatchImportTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        server.DB = Path(self.directory.name) / "test.sqlite3"
        self.payload = json.loads((server.ROOT / "example.json").read_text())

    def tearDown(self):
        self.directory.cleanup()

    def jobs(self):
        with server.connect() as db:
            return [json.loads(row[0]) for row in db.execute("SELECT body FROM records WHERE kind='jobs'")]

    def test_repeat_import_preserves_decisions_and_all_keyword_hits(self):
        server.import_batch(self.payload)
        job = self.jobs()[0]
        job.update(status="已投递", appliedAt="2026-11-20T01:00:00+00:00", reason="本人确认", history=[{"to":"已投递"}])
        with server.connect() as db:
            server.upsert(db, "jobs", job["id"], job)
        self.payload["run"].update(id="second-keyword", keyword="触达运营")
        self.payload["jobs"][0].update(status="待评估", history=[])
        result = server.import_batch(self.payload)
        saved = self.jobs()[0]
        self.assertEqual(result["updated"], 1)
        self.assertEqual(saved["status"], "已投递")
        self.assertEqual(saved["appliedAt"], job["appliedAt"])
        self.assertEqual(saved["history"], job["history"])
        self.assertEqual(saved["firstSeen"], job["firstSeen"])
        self.assertEqual(len(saved["runIds"]), 2)

    def test_invalid_batch_does_not_partially_write(self):
        self.payload["jobs"].append({"company":"invalid"})
        with self.assertRaises(ValueError):
            server.import_batch(self.payload)
        self.assertEqual(self.jobs(), [])

    def test_changed_jd_invalidates_old_review(self):
        server.import_batch(self.payload)
        changed = copy.deepcopy(self.payload)
        changed["jobs"][0]["jd"] += " 新的核心要求"
        server.import_batch(changed)
        self.assertIsNone(self.jobs()[0]["review"])


if __name__ == "__main__":
    unittest.main()
