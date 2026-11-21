# SPDX-License-Identifier: GPL-2.0-only
"""Rebuild the separately distributed TimGM6mb sample data used by RhythmDesk."""
import base64
import json
from pathlib import Path
import struct

SAMPLES = {
    "shekere:X": ("Cabasa", 0.65),
    "bell:X": ("Cowbell", 0.67),
    "tumba": ("Low Tumba Tone", 0.78),
    "quinto": ("Quinto Tone", 0.78),
    "closedSlap": ("QuintoClosedSlap", 0.78),
    "bongo": ("M Bongo Tone", 0.78),
    "rim": ("E Bongo Rim", 0.78),
    "taiko": ("Taiko Drum", 0.78),
}


def chunks(data, start, end):
    while start + 8 <= end:
        name, size = struct.unpack_from("<4sI", data, start)
        offset = start + 8
        yield name, offset, size
        start = offset + size + size % 2


source = Path(__file__).resolve().parent
soundfont = (source / "TimGM6mb.sf2").read_bytes()
lists = {
    soundfont[offset:offset + 4]: dict(
        (tag, (item, length))
        for tag, item, length in chunks(soundfont, offset + 4, offset + size)
    )
    for name, offset, size in chunks(soundfont, 12, len(soundfont))
    if name == b"LIST"
}
pcm_start, _ = lists[b"sdta"][b"smpl"]
header_start, header_size = lists[b"pdta"][b"shdr"]
headers = {
    name.rstrip(b"\0").decode("ascii", errors="replace"): (start, end, rate)
    for name, start, end, _, _, rate, _, _, _, _ in struct.iter_unpack(
        "<20sIIIIIBbHH", soundfont[header_start:header_start + header_size]
    )
}

recordings = {}
for key, (name, level) in SAMPLES.items():
    start, end, rate = headers[name]
    samples = struct.unpack_from(f"<{end - start}h", soundfont, pcm_start + 2 * start)
    peak = max(map(abs, samples))
    first = next(index for index, value in enumerate(samples) if abs(value) >= peak * 0.025)
    samples = samples[max(0, first - round(rate * 0.001)):]
    scale = 32767 * level / peak
    fade = round(rate * 0.008)
    pcm = struct.pack(
        f"<{len(samples)}h",
        *(round(value * scale * min(1, index / 12, (len(samples) - 1 - index) / fade))
          for index, value in enumerate(samples))
    )
    recordings[key] = {"rate": rate, "pcm": base64.b64encode(pcm).decode("ascii")}

(source.parent / "recorded-samples.js").write_text(
    "/* TimGM6mb-derived sample data, GPL-2.0-only. See sounds/source. */\n"
    "globalThis.RHYTHM_DESK_RECORDINGS = " + json.dumps(recordings, indent=2) + ";\n",
    encoding="utf-8",
)
