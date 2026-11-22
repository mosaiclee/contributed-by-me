"""Package the iPhone editor as a standalone HTML file and an HTTPS offline web app."""
import argparse
import base64
import hashlib
import json
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('web_zip', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with ZipFile(args.web_zip) as archive:
        root = 'RhythmDesk-iPhone-Web/'
        page = archive.read(root + 'index.html').decode()
        samples = archive.read(root + 'sounds/recorded-samples.js').decode()
        original_icon = archive.read(root + 'apple-touch-icon.png')
        licenses = {name[len(root):]: archive.read(name) for name in archive.namelist()
                    if name.startswith(root + 'sounds/source/') and not name.endswith('/')}
    marker = '<script src="sounds/recorded-samples.js"></script>'
    assert page.count(marker) == 1 and '</script' not in samples.lower()
    page = page.replace(marker, '<script>\n' + samples + '\n</script>')
    icon_link = '<link rel="apple-touch-icon" href="apple-touch-icon.png">'
    assert page.count(icon_link) == 1
    encoded = base64.b64encode(original_icon).decode()
    local = page.replace('<link rel="icon" type="image/png" href="apple-touch-icon.png">\n', '')
    local = local.replace(icon_link, '<link rel="icon" href="data:image/png;base64,' + encoded + '">')
    # The message remains visible if a file preview blocks JavaScript or startup fails.
    fallback = Path(__file__).with_name('local-fallback.html').read_text(encoding='utf-8')
    local = local.replace('<body>', '<body>\n' + fallback, 1)
    end = local.rindex('</script>')
    local = local[:end] + "\ndocument.getElementById('local-preview-message').hidden = true;\n" + local[end:]
    local_name = 'RhythmDesk-iPhone-Offline.html'
    (args.output / local_name).write_bytes(local.encode('utf-8'))
    controls = Path(__file__).with_name('install.html').read_text(encoding='utf-8')
    hosted = page.replace('</head>', '<link rel="manifest" href="manifest.webmanifest">\n</head>', 1)
    hosted = hosted.replace('</body>', controls + '\n</body>', 1)
    files = {'index.html': hosted.encode(), 'offline-shell.html': hosted.encode(),
             local_name: local.encode(),
             'apple-touch-icon.png': original_icon}
    for size in (192, 512):
        image = Image.open(BytesIO(original_icon)).resize((size, size), Image.Resampling.LANCZOS)
        buffer = BytesIO()
        image.save(buffer, 'PNG')
        files[f'app-{size}.png'] = buffer.getvalue()
    manifest = {
        'id': './', 'name': '鼓谱工作台 · RhythmDesk', 'short_name': 'RhythmDesk',
        'start_url': './', 'scope': './', 'display': 'standalone',
        'background_color': '#ede2d2', 'theme_color': '#ede2d2',
        'icons': [{'src': f'app-{size}.png', 'sizes': f'{size}x{size}', 'type': 'image/png'}
                  for size in (192, 512)],
    }
    files['manifest.webmanifest'] = json.dumps(manifest, ensure_ascii=False).encode()
    digest = hashlib.sha256()
    for name, data in sorted(files.items()):
        digest.update(name.encode() + b'\0' + hashlib.sha256(data).digest())
    worker = Path(__file__).with_name('sw.js').read_text(encoding='utf-8')
    digest.update(worker.encode())
    build_id = digest.hexdigest()[:16]
    required = {'./': hashlib.sha256(files['index.html']).hexdigest(),
                local_name: hashlib.sha256(files[local_name]).hexdigest()}
    files['sw.js'] = worker.replace('__BUILD_ID__', build_id).replace(
        '__REQUIRED_DIGESTS__', json.dumps(required)).encode()
    files['Readme.txt'] = Path(__file__).with_name('Readme.txt').read_bytes()
    files.update(licenses)
    with ZipFile(args.output / 'RhythmDesk-iPhone-Offline-PWA.zip', 'w', ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = ZipInfo('RhythmDesk-iPhone-Offline-PWA/' + name, (2026, 11, 22, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)


if __name__ == '__main__':
    main()
