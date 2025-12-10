from __future__ import annotations

import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path
from typing import Tuple


ROOT = Path(__file__).parent
VIDEO_DIR = ROOT / "videos"
AUDIO_DIR = ROOT / "audios"


def transliterate_bg_to_latin(text: str) -> str:
    """Transliterate Bulgarian Cyrillic to Latin and return a safe slug."""
    mapping = {
        "а": "a",
        "б": "b",
        "в": "v",
        "г": "g",
        "д": "d",
        "е": "e",
        "ж": "zh",
        "з": "z",
        "и": "i",
        "й": "y",
        "к": "k",
        "л": "l",
        "м": "m",
        "н": "n",
        "о": "o",
        "п": "p",
        "р": "r",
        "с": "s",
        "т": "t",
        "у": "u",
        "ф": "f",
        "х": "h",
        "ц": "ts",
        "ч": "ch",
        "ш": "sh",
        "щ": "sht",
        "ъ": "a",
        "ь": "",
        "ю": "yu",
        "я": "ya",
        "ѝ": "i",
        "ё": "yo",
        "А": "A",
        "Б": "B",
        "В": "V",
        "Г": "G",
        "Д": "D",
        "Е": "E",
        "Ж": "Zh",
        "З": "Z",
        "И": "I",
        "Й": "Y",
        "К": "K",
        "Л": "L",
        "М": "M",
        "Н": "N",
        "О": "O",
        "П": "P",
        "Р": "R",
        "С": "S",
        "Т": "T",
        "У": "U",
        "Ф": "F",
        "Х": "H",
        "Ц": "Ts",
        "Ч": "Ch",
        "Ш": "Sh",
        "Щ": "Sht",
        "Ъ": "A",
        "Ь": "",
        "Ю": "Yu",
        "Я": "Ya",
        "Ѝ": "I",
        "Ё": "Yo",
    }

    transliterated = "".join(mapping.get(char, char) for char in text)
    normalized = unicodedata.normalize("NFKD", transliterated)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_text.lower()).strip("-")
    return slug or "audio"


def parse_video_name(video_path: Path) -> Tuple[str, str]:
    """
    Extract the leading number and the rest of the title from a video file name.

    Examples:
    - '1. Example.mp4' -> ('1', 'Example')
    - '10 - Sample name.MP4' -> ('10', 'Sample name')
    """
    stem = video_path.stem
    match = re.match(r"^\s*(\d+)\s*[._-]?\s*(.*)$", stem)
    if not match:
        raise ValueError(f"Could not parse video name: {video_path.name}")
    number, title = match.groups()
    return number, title


def ensure_ffmpeg_available() -> None:
    if shutil.which("ffmpeg"):
        return
    sys.stderr.write("ffmpeg is required but was not found in PATH.\n")
    sys.exit(1)


def extract_audio(video_path: Path) -> Path:
    number, title = parse_video_name(video_path)
    slug = transliterate_bg_to_latin(title)
    output_path = AUDIO_DIR / f"{number}-{slug}.mp3"

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_path),
        "-vn",
        "-map",
        "0:a:0?",
        "-c:a",
        "mp3",
        "-q:a",
        "2",
        str(output_path),
    ]

    print(f"[ffmpeg] {video_path.name} -> {output_path.name}")
    subprocess.run(cmd, check=True)
    return output_path


def main() -> None:
    ensure_ffmpeg_available()
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    video_files = sorted(VIDEO_DIR.glob("*.mp4"))
    if not video_files:
        print("No .mp4 files found in the videos directory.")
        return

    for video in video_files:
        try:
            extract_audio(video)
        except subprocess.CalledProcessError as exc:
            sys.stderr.write(f"ffmpeg failed for {video.name}: {exc}\n")
        except ValueError as exc:
            sys.stderr.write(f"{exc}\n")


if __name__ == "__main__":
    main()
