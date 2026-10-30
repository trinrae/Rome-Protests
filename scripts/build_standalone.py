#!/usr/bin/env python3
"""Generate an easy-to-open HTML snapshot of the public-facing prototype.

Standalone is a local snapshot. Automated RSS discovery requires publishing the
full repo with its GitHub Actions workflow.
"""
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'Rome-Protest-Monitor-Standalone.html'
html=(ROOT/'index.html').read_text('utf-8')
css=(ROOT/'styles.css').read_text('utf-8')
js=(ROOT/'app.js').read_text('utf-8')
data=(ROOT/'data/snapshot.js').read_text('utf-8')
html=re.sub(r'<link rel="stylesheet" href="styles.css"\s*/>', '', html)
html=re.sub(r'<script defer src="data/snapshot.js"></script>', '', html)
html=re.sub(r'<script defer src="app.js"></script>', '', html)
html=html.replace('</head>', '<style>\n'+css+'\n</style>\n</head>')
html=html.replace('</body>', '<script>\ndocument.addEventListener("DOMContentLoaded", function () {\n'+data+'\n'+js+'\n});\n</script>\n</body>')
OUT.write_text(html,encoding='utf-8')
print(f'Built standalone snapshot: {OUT} ({OUT.stat().st_size:,} bytes)')
