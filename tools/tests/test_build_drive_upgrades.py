from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from tools.build_drive_upgrades import DEFAULT_TEMPLATE, build


class DriveUpgradeBuilderTests(unittest.TestCase):
    def test_copy_adds_isolated_sidecar_and_leaves_source_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            downloads = root / "downloads"
            outputs = root / "outputs"
            downloads.mkdir()
            source = downloads / "sample-project.zip"
            source_members = {
                "README.md": b"original project README\n",
                "inc_bot_ai/original.txt": b"existing top-level sidecar name\n",
                "src/main.py": b"print('hello')\n",
            }
            with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for name, payload in source_members.items():
                    archive.writestr(name, payload)
            source_hash = hashlib.sha256(source.read_bytes()).hexdigest()

            manifest = root / "input.json"
            manifest.write_text(
                json.dumps({
                    "repos": [{
                        "drive_file_id": "drive-sample-id",
                        "name": source.name,
                        "parent_folder": "drive-parent-id",
                    }]
                }),
                encoding="utf-8",
            )

            result = build(manifest, downloads, outputs, DEFAULT_TEMPLATE)

            self.assertEqual(result["source_repo_count"], 1)
            self.assertEqual(result["upgraded_copy_count"], 1)
            self.assertEqual(result["missing_source_count"], 0)
            self.assertEqual(result["failed_count"], 0)
            row = result["outputs"][0]
            upgraded_path = Path(row["local_path"])
            self.assertTrue(upgraded_path.is_file())
            self.assertEqual(row["source_archive_sha256"], source_hash)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), source_hash)
            self.assertEqual(row["sidecar_path"], "inc_bot_ai_upgrade_2")

            with zipfile.ZipFile(source) as original, zipfile.ZipFile(upgraded_path) as upgraded:
                original_infos = original.infolist()
                upgraded_infos = upgraded.infolist()
                self.assertEqual(
                    [info.filename for info in upgraded_infos[:len(original_infos)]],
                    [info.filename for info in original_infos],
                )
                for index, original_info in enumerate(original_infos):
                    copied_info = upgraded_infos[index]
                    self.assertEqual(original.read(original_info), upgraded.read(copied_info))
                    self.assertEqual(original_info.CRC, copied_info.CRC)
                    self.assertEqual(original_info.file_size, copied_info.file_size)
                self.assertIsNone(upgraded.testzip())

                sidecar = row["sidecar_path"]
                profile = json.loads(upgraded.read(f"{sidecar}/project_profile.json"))
                metadata = json.loads(upgraded.read(f"{sidecar}/upgrade.json"))
                self.assertEqual(profile["source_drive_file_id"], "drive-sample-id")
                self.assertEqual(profile["existing_root_collisions"], [])
                self.assertEqual(metadata["source_archive_sha256"], source_hash)
                self.assertTrue(metadata["zip_central_directory_updated_in_copy"])
                self.assertFalse(metadata["upstream_source_changed"])
                self.assertEqual(metadata["original_files_overwritten"], 0)
                self.assertIn(f"{sidecar}/launcher.py", upgraded.namelist())
                self.assertIn(f"{sidecar}/agency/vercel/manifest.webmanifest", upgraded.namelist())

    def test_strict_mode_rejects_a_missing_archive_before_writing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest = root / "input.json"
            manifest.write_text(
                json.dumps({"repos": [{
                    "drive_file_id": "missing-id",
                    "name": "missing.zip",
                    "parent_folder": "parent-id",
                }]}),
                encoding="utf-8",
            )
            outputs = root / "outputs"
            with self.assertRaises(FileNotFoundError):
                build(manifest, root / "downloads", outputs, DEFAULT_TEMPLATE)
            self.assertFalse(outputs.exists())


if __name__ == "__main__":
    unittest.main()
