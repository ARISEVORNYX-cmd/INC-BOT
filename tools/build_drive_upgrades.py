#!/usr/bin/env python3
"""Create copy-only, repository-specific AI sidecar ZIP upgrades.

Inputs are original Google Drive ZIPs staged under google_drive/. Source ZIPs
are never modified. Each output starts as a copy of its source and appends an
isolated `inc_bot_ai/` directory with this repo's agents/, agency/, mobile PWA,
tests, launcher and a small repo-profile file. Appending updates the ZIP
central directory, so the output is not byte-identical to the source archive.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "AI-Agency-All-Repos-Manifest-v2.json"
DEFAULT_DOWNLOADS = ROOT / "google_drive"
DEFAULT_OUTPUT = ROOT / "google_drive" / "upgraded-repos"
DEFAULT_OUTPUT_MANIFEST = ROOT / "AI-Agency-Upgraded-Repos-v1.json"
DEFAULT_TEMPLATE = ROOT / "tools" / "drive_upgrade_template"
SKIP_DIRS = {"__pycache__", ".git", ".venv", "node_modules", "runs", ".runtime", "dist", "coverage", "target"}
SKIP_NAMES = {".env", ".netrc", ".git-credentials", "credentials", "id_rsa", "id_ed25519"}
MARKERS = {
    "python": {"pyproject.toml", "setup.py", "requirements.txt", "Pipfile"},
    "javascript_typescript": {"package.json", "tsconfig.json", "pnpm-lock.yaml", "yarn.lock"},
    "rust": {"Cargo.toml"},
    "go": {"go.mod"},
    "java_kotlin": {"pom.xml", "build.gradle", "build.gradle.kts"},
    "dotnet": {"*.csproj", "*.sln"},
    "flutter_dart": {"pubspec.yaml"},
    "ruby": {"Gemfile"},
    "php": {"composer.json"},
    "swift": {"Package.swift"},
    "c_cpp": {"CMakeLists.txt", "Makefile"},
}


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_files(base: Path) -> list[Path]:
    result: list[Path] = []
    for path in sorted(base.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(base)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if path.name in SKIP_NAMES or path.name.startswith(".env") or path.suffix.lower() in {".pyc", ".pyo"}:
            continue
        result.append(path)
    return result


def _profile(zf: zipfile.ZipFile, repo: dict[str, Any], sidecar: str) -> dict[str, Any]:
    names = [info.filename for info in zf.infolist() if not info.is_dir()]
    basenames = {Path(name.replace("\\", "/")).name for name in names}
    stack_markers: list[str] = []
    for stack, patterns in MARKERS.items():
        if any(
            pattern in basenames if not pattern.startswith("*")
            else any(re.fullmatch(pattern.replace("*", ".*"), item) for item in basenames)
            for pattern in patterns
        ):
            stack_markers.append(stack)
    roots = sorted({name.replace("\\", "/").split("/", 1)[0] for name in names if "/" in name})
    root_files = {name.replace("\\", "/").split("/", 1)[0] for name in names if "/" not in name}
    collisions = []
    for candidate in ("agents", "agency", sidecar):
        if candidate.lower() in {r.lower() for r in roots} or candidate.lower() in {n.lower() for n in root_files}:
            collisions.append(candidate)
    return {
        "source_archive": repo["name"],
        "source_drive_file_id": repo["drive_file_id"],
        "source_parent_folder_id": repo["parent_folder"],
        "source_file_count": len(names),
        "top_level_directories_sample": roots[:30],
        "stack_markers_detected_from_filenames": stack_markers,
        "existing_root_collisions": collisions,
        "note": "Metadata-only profile; upstream source files were not executed, reviewed line-by-line, or modified.",
    }


def _choose_sidecar(zf: zipfile.ZipFile) -> str:
    roots = {name.replace("\\", "/").split("/", 1)[0].lower() for name in zf.namelist() if name}
    name = "inc_bot_ai"
    version = 1
    while name.lower() in roots:
        version += 1
        name = f"inc_bot_ai_upgrade_{version}"
    return name


def _write_overlay(out: zipfile.ZipFile, sidecar: str, profile: dict[str, Any], template: Path, code_roots: tuple[Path, ...]) -> int:
    added = 0
    for package in code_roots:
        for source in _safe_files(package):
            relative = source.relative_to(package.parent).as_posix()
            out.write(source, f"{sidecar}/{relative}")
            added += 1
    template_files = _safe_files(template)
    runtime_ignore = template / ".runtime" / ".gitignore"
    if runtime_ignore.is_file() and runtime_ignore not in template_files:
        template_files.append(runtime_ignore)
        template_files.sort()
    for source in template_files:
        relative = source.relative_to(template).as_posix()
        if relative == "README.md":
            text = source.read_text(encoding="utf-8").replace("inc_bot_ai/", f"{sidecar}/")
            out.writestr(f"{sidecar}/README.md", text)
        else:
            out.write(source, f"{sidecar}/{relative}")
        added += 1
    out.writestr(f"{sidecar}/project_profile.json", json.dumps(profile, ensure_ascii=False, indent=2) + "\n")
    added += 1
    return added


def build(manifest_path: Path, downloads: Path, output_dir: Path, template: Path, strict: bool = True) -> dict[str, Any]:
    manifest = _read_json(manifest_path)
    repos = manifest.get("repos") or []
    if not repos:
        raise ValueError("manifest has no repo entries")
    code_roots = (ROOT / "agents", ROOT / "agency")
    for source in code_roots:
        if not source.is_dir():
            raise FileNotFoundError(source)
    if not (template / "launcher.py").is_file() or not (template / "README.md").is_file():
        raise FileNotFoundError(f"upgrade template is incomplete: {template}")
    missing = [row["name"] for row in repos if not (downloads / row["name"]).is_file()]
    if missing and strict:
        raise FileNotFoundError("missing staged source ZIPs: " + ", ".join(missing))
    output_dir.mkdir(parents=True, exist_ok=True)
    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    outputs: list[dict[str, Any]] = []

    for repo in repos:
        source = downloads / repo["name"]
        if not source.is_file():
            outputs.append({"source_name": repo["name"], "status": "source_not_downloaded"})
            continue
        if not zipfile.is_zipfile(source):
            outputs.append({"source_name": repo["name"], "status": "invalid_zip"})
            continue
        safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", repo["name"].removesuffix(".zip")).strip("._-") or "repository"
        dest = output_dir / f"{safe_stem}--INC-BOT-AI-Upgraded-v1.zip"
        try:
            source_bytes = source.stat().st_size
            source_sha256 = _sha256(source)
            with zipfile.ZipFile(source, "r") as original:
                sidecar = _choose_sidecar(original)
                profile = _profile(original, repo, sidecar)
                shutil.copyfile(source, dest)
                with zipfile.ZipFile(dest, "a", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as upgraded:
                    upgrade_meta = {
                        "upgrade_version": 1,
                        "generated_at_utc": generated,
                        "sidecar_path": sidecar,
                        "source_archive": repo["name"],
                        "source_drive_file_id": repo["drive_file_id"],
                        "source_archive_bytes": source_bytes,
                        "source_archive_sha256": source_sha256,
                        "zip_central_directory_updated_in_copy": True,
                        "original_files_overwritten": 0,
                        "integration_type": "isolated repository-aware AI sidecar",
                        "upstream_source_changed": False,
                        "repo_specific_code_changes": False,
                        "runtime_tests": "shared sidecar tests are bundled; upstream project tests not run",
                    }
                    added = _write_overlay(upgraded, sidecar, profile, template, code_roots)
                    upgraded.writestr(f"{sidecar}/upgrade.json", json.dumps(upgrade_meta, ensure_ascii=False, indent=2) + "\n")
                    added += 1
                with zipfile.ZipFile(dest, "r") as check:
                    check.read(f"{sidecar}/upgrade.json")
                    check.read(f"{sidecar}/launcher.py")
                outputs.append({
                    "source_name": repo["name"],
                    "source_drive_file_id": repo["drive_file_id"],
                    "source_parent_folder_id": repo["parent_folder"],
                    "upgraded_name": dest.name,
                    "local_path": dest.relative_to(ROOT).as_posix() if dest.is_relative_to(ROOT) else str(dest),
                    "sidecar_path": sidecar,
                    "status": "upgraded_copy_created",
                    "added_overlay_entries": added,
                    "source_bytes": source_bytes,
                    "source_archive_sha256": source_sha256,
                    "upgraded_bytes": dest.stat().st_size,
                    "profile": profile,
                    "original_drive_zip_modified": False,
                })
        except (OSError, zipfile.BadZipFile, RuntimeError, ValueError) as exc:
            try:
                dest.unlink(missing_ok=True)
            except OSError:
                pass
            outputs.append({"source_name": repo["name"], "status": "upgrade_failed", "error": f"{type(exc).__name__}: {exc}"})

    result_manifest = {
        "generated_by": "INC-BOT / Arena agent",
        "generated_at_utc": generated,
        "version": 1,
        "purpose": "47 separate repository archive copies with an isolated INC-BOT Ari + Level-3 + sales/PWA sidecar. Original source ZIPs remain unchanged.",
        "source_manifest": str(manifest_path.relative_to(ROOT)) if manifest_path.is_relative_to(ROOT) else manifest_path.name,
        "source_repo_count": len(repos),
        "upgraded_copy_count": sum(row.get("status") == "upgraded_copy_created" for row in outputs),
        "missing_source_count": sum(row.get("status") == "source_not_downloaded" for row in outputs),
        "failed_count": sum(row.get("status") == "upgrade_failed" or row.get("status") == "invalid_zip" for row in outputs),
        "originals_modified": 0,
        "upstream_code_customized": 0,
        "note": "The full shared AI kit is added to a copy without overwriting the upstream app. Appending entries updates each output ZIP's central directory; the staged source ZIP remains byte-for-byte untouched and is identified by its SHA-256. Per-repo profiles are filename-based; no upstream build/tests were run. For app-specific code rewrites, each project needs a separate code review and feature plan.",
        "outputs": outputs,
    }
    return result_manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--downloads", type=Path, default=DEFAULT_DOWNLOADS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--template", type=Path, default=DEFAULT_TEMPLATE)
    parser.add_argument("--allow-missing", action="store_true", help="Create copies for staged ZIPs and report the rest as missing")
    parser.add_argument("--manifest-out", type=Path, default=None)
    args = parser.parse_args(argv)
    result = build(args.manifest.resolve(), args.downloads.resolve(), args.output.resolve(), args.template.resolve(), strict=not args.allow_missing)
    manifest_out = (args.manifest_out or DEFAULT_OUTPUT_MANIFEST).resolve()
    manifest_out.parent.mkdir(parents=True, exist_ok=True)
    manifest_out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "manifest_out": str(manifest_out),
        "source_repo_count": result["source_repo_count"],
        "upgraded_copy_count": result["upgraded_copy_count"],
        "missing_source_count": result["missing_source_count"],
        "failed_count": result["failed_count"],
        "output_dir": str(args.output.resolve()),
    }, ensure_ascii=False, indent=2))
    return 0 if result["failed_count"] == 0 and result["missing_source_count"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
