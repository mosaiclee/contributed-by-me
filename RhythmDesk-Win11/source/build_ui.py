"""Assemble the standalone, offline editor from the readable source files."""
from pathlib import Path
from base64 import b64encode
import sys

ui = Path(__file__).resolve().parent / "ui"
target = Path(sys.argv[1]) if len(sys.argv) > 1 else ui.parent.parent / "RhythmDesk.html"
page = (ui / "index.html").read_text(encoding="utf-8")
style = (ui / "style.css").read_text(encoding="utf-8")
scripts = "\n".join((ui / f"{name}.js").read_text(encoding="utf-8") for name in ("i18n", "model", "presets", "user-recordings", "audio", "score-export", "app"))
guide_dir = ui / "help"
guide = (guide_dir / "guide.html").read_text(encoding="utf-8")
guide = guide.replace("{{english}}", (guide_dir / "guide.en.html").read_text(encoding="utf-8"))
for name in ("home", "editor", "swing", "mix"):
    encoded = b64encode((guide_dir / f"{name}.jpg").read_bytes()).decode("ascii")
    guide = guide.replace("{{" + name + "}}", "data:image/jpeg;base64," + encoded)
footer = ('<footer class="guide-brand"><img alt="" src="{{logo}}">'
          '<span><span class="brand-latin">Zebra Djembe</span><span class="brand-cn" lang="zh-CN">【斑马非洲鼓工作室】</span></span></footer>')
logo = b64encode((guide_dir / "logo.png").read_bytes()).decode("ascii")
guide = guide.replace("{{footer}}", footer.replace("{{logo}}", "data:image/png;base64," + logo))
page = page.replace("<!-- GUIDE -->", guide)
page = page.replace("<!-- STYLE -->", f"<style>\n{style}</style>")
page = page.replace("<!-- SCRIPTS -->", f"<script>\n'use strict';\n{scripts}</script>")
target.write_bytes(page.encode("utf-8"))
