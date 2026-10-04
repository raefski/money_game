#!/usr/bin/env python3
"""Build a single-file copy of the game for hosts that wrap pages in their own skeleton.

Claude artifacts publish a page *fragment*: no <html>/<head>/<body>, and CSS and
JS must be inlined. This script turns the modular source (index.html, style.css and
the three scripts) into that fragment, keeping the Google Fonts links, which the host
allows. The modular files stay the source of truth: rebuild after every change.

    python3 tools/build-artifact.py /path/to/output.html
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def read(name):
    return (ROOT / name).read_text(encoding="utf-8")


def main(out_path):
    html = read("index.html")

    title = re.search(r"<title>.*?</title>", html, re.S).group(0)
    font_links = re.findall(r'<link rel="(?:preconnect|stylesheet)"[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>', html)
    body = re.search(r"<body[^>]*>(.*)</body>", html, re.S).group(1)

    scripts = re.findall(r'<script src="([^"]+)"></script>', body)
    body = re.sub(r'\s*<script src="[^"]+"></script>', "", body).strip()
    css = read("style.css")
    js = [(name, read(name)) for name in scripts]

    # Inlined text must not be able to end its own element or open an HTML comment.
    for name, text in [("style.css", css)] + js:
        for bad in ("</script", "</style", "<!--"):
            if bad in text:
                sys.exit(f"{name} contains {bad!r}, which is unsafe to inline")

    parts = [title, *font_links, f"<style>\n{css}\n</style>", body]
    parts += [f"<script>\n{text}\n</script>" for _, text in js]
    out = "\n".join(parts) + "\n"

    path = pathlib.Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(out, encoding="utf-8")
    print(f"wrote {path} ({len(out) / 1024:.0f} KB; inlined {', '.join(n for n, _ in js)} + style.css)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
