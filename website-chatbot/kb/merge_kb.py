#!/usr/bin/env python3
"""Merge a folder of text documents into ONE knowledge-base file.

Why this exists: the current RAGForge backend creates one collection per
uploaded file, and /api/query answers from a single collection. The clean
way to give a website chatbot a multi-topic knowledge base - without
changing the backend - is to upload ONE combined document.

Usage:
    python3 merge_kb.py ./my-docs ./knowledge-base.txt

Reads every .txt and .md file in ./my-docs (sorted by name), and writes
./knowledge-base.txt with a clear heading per source file, which also
helps retrieval chunking. Upload the result once via /api/upload and put
the returned collection_name in the widget config.
"""

import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 1

    source_dir = Path(sys.argv[1])
    out_path = Path(sys.argv[2])

    files = sorted(
        p for p in source_dir.iterdir()
        if p.is_file() and p.suffix.lower() in {".txt", ".md"}
    )
    if not files:
        print(f"No .txt or .md files found in {source_dir}")
        return 1

    sections = []
    for path in files:
        title = path.stem.replace("-", " ").replace("_", " ").strip().title()
        text = path.read_text(encoding="utf-8", errors="replace").strip()
        if text:
            sections.append(f"{title}\n\n{text}")

    out_path.write_text("\n\n---\n\n".join(sections) + "\n", encoding="utf-8")
    print(f"Merged {len(sections)} file(s) into {out_path} "
          f"({out_path.stat().st_size} bytes).")
    print("Next: upload it to RAGForge (POST /api/upload) and note the "
          "returned collection_name for the widget config.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
