#!/usr/bin/env python3
"""Create a minimal static GitHub Pages directory without including source scripts."""
from pathlib import Path
import shutil

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist'
OUT.mkdir(parents=True,exist_ok=True)
for relative in ('index.html','styles.css','app.js','data/snapshot.js','assets/favicon.svg'):
    dest=OUT/relative
    dest.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(ROOT/relative,dest)
(OUT/'.nojekyll').write_text('',encoding='utf-8')
print(f'Built GitHub Pages directory: {OUT}')
