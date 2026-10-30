"""Builds the two extension packages from one source.

    python build.py     ->  dist/hermes-tabs/, dist/agent-tabs/ and a zip of each

hermes-tabs is extension/ as it is (load extension/ directly while developing). agent-tabs is the same code with the
files from brand/agent/ on top: brand.js, brand.css, icons, and the texts that name Hermes (merged into _locales).
The build fails if anything in agent-tabs still mentions Hermes.
"""
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC, DIST = HERE / "extension", HERE / "dist"
DROP = {"agent": ["NOTICE"]}  # NOTICE credits the Hermes logo, which agent-tabs does not contain


def build(name: str) -> Path:
    out = DIST / f"{name}-tabs"
    shutil.rmtree(out, ignore_errors=True)
    shutil.copytree(SRC, out)
    shutil.copy(HERE / "LICENSE", out / "LICENSE")
    brand = HERE / "brand" / name
    if brand.is_dir():
        for f in brand.iterdir():
            if f.is_file():
                shutil.copy(f, out / f.name)
        for lang in (brand / "_locales").iterdir():
            target = out / "_locales" / lang.name / "messages.json"
            messages = json.loads(target.read_text(encoding="utf-8"))
            for key, value in json.loads((lang / "messages.json").read_text(encoding="utf-8")).items():
                if key not in messages:
                    sys.exit(f"{lang.name}: override for unknown key {key}")
                messages[key] = value
            target.write_text(json.dumps(messages, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        for f in DROP.get(name, []):
            (out / f).unlink()
        left = [f"{f.relative_to(out)}" for f in out.rglob("*")
                if f.is_file() and f.suffix != ".png" and "hermes" in f.read_text(encoding="utf-8").lower()]
        if left:
            sys.exit(f"{name}-tabs still mentions Hermes in: {', '.join(left)}")
    version = json.loads((out / "manifest.json").read_text())["version"]
    for old in DIST.glob(f"{name}-tabs-*.zip"):  # zips of earlier versions
        old.unlink()
    shutil.make_archive(str(DIST / f"{name}-tabs-{version}"), "zip", out)
    return out


if __name__ == "__main__":
    for n in ("hermes", "agent"):
        print(build(n))
