"""Optional packaging only. No Python dependency in the TypeScript game core."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
import hashlib
import json
import sys

root = Path(__file__).resolve().parents[1]
output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root.parent / "Nomad-City-Online-v0.2.0.zip"
excluded = {"node_modules", "dist", "coverage", ".git", "__pycache__"}
files = sorted(p for p in root.rglob("*") if p.is_file() and not any(part in excluded for part in p.relative_to(root).parts))
with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for file in files:
        name = "nomad-city-online/" + file.relative_to(root).as_posix()
        entry = ZipInfo(name, date_time=(2026, 10, 13, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, file.read_bytes())
with ZipFile(output) as archive:
    if archive.testzip() is not None:
        raise RuntimeError("ZIP CRC verification failed")
    expected = {"nomad-city-online/" + f.relative_to(root).as_posix() for f in files}
    if set(archive.namelist()) != expected:
        raise RuntimeError("ZIP inventory does not match source")
    for file in files:
        if archive.read("nomad-city-online/" + file.relative_to(root).as_posix()) != file.read_bytes():
            raise RuntimeError("ZIP content mismatch: " + str(file))
print(json.dumps({"path": str(output), "files": len(files), "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "verification": "CRC + inventory + every file byte comparison passed"}))
