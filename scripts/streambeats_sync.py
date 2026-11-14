#!/usr/bin/env python3
"""
OhMyGramola — StreamBeats Automated Synchronizer (streambeats_sync.py)
Downloads and indexes DMCA-Free music by Harris Heller directly from the
official StreamBeats Google Drive repository into P:\\IA\\RRSS\\Music\\StreamBeats\\<Genero>\\.
Generates full OhMyGramola sidecars (.json y _attribution.txt) and updates the local catalog.
"""

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime

# StreamBeats Google Drive Folder IDs by Genre / Collection
STREAMBEATS_GENRES = {
    "Lofi": {
        "folder_id": "1D-pS3WGZ0vmWKGjTj_lkbdrjAtSG4YVD",
        "description": "Chill / Study / Lo-Fi Beats"
    },
    "Synthwave": {
        "folder_id": "12yCE2X7n0DCBS1HBb1PipVeKFO8mMPPv",
        "description": "Retro / 80s / Groovy Synthwave"
    },
    "Hype": {
        "folder_id": "1dga1yqsrQGuA6b-K0v_02UeL-oSnydZF",
        "description": "High Energy / 100 Thieves Hype"
    }
}

DEFAULT_LIBRARY_DIR = r"P:\IA\RRSS\Music"
AUDIO_EXTS = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}

def clean_track_name(raw_name: str):
    name = re.sub(r'^\d+\.\s*', '', raw_name)
    artist = "Harris Heller / StreamBeats"
    title = name
    if " - " in name:
        parts = name.split(" - ", 1)
        artist = parts[0].strip()
        title = parts[1].strip()
    return artist, title

def sync_genre_folder(genre_name: str, folder_id: str, library_dir: str, limit_albums: int = 0):
    try:
        import gdown
    except ImportError:
        print("[ERROR] gdown is required. Install via pip install gdown")
        return 0

    print(f"\n=== Sincronizando StreamBeats género: {genre_name} ===", flush=True)
    folder_url = f"https://drive.google.com/drive/folders/{folder_id}"

    temp_base = os.path.join(tempfile.gettempdir(), f"OhMyGramola-StreamBeats-{genre_name}")
    os.makedirs(temp_base, exist_ok=True)

    dest_genre_dir = os.path.join(library_dir, "StreamBeats", genre_name)
    os.makedirs(dest_genre_dir, exist_ok=True)

    manifest_path = os.path.join(library_dir, ".sync_manifest.json")
    manifest = {"version": 1, "lastUpdated": None, "tracks": {}}
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
        except Exception:
            pass

    # Download folder via gdown
    print(f"Descargando archivos desde Google Drive a temporal: {temp_base} ...", flush=True)
    downloaded_files = gdown.download_folder(folder_url, output=temp_base, quiet=False)
    print(f"Descarga finalizada. Procesando e ingiriendo en {dest_genre_dir} ...", flush=True)

    ingested = 0
    for root, dirs, fnames in os.walk(temp_base):
        for fn in fnames:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in AUDIO_EXTS:
                continue

            raw_base = os.path.splitext(fn)[0]
            artist, clean_title = clean_track_name(raw_base)

            target_audio = os.path.join(dest_genre_dir, f"{clean_title}{ext}")
            target_json = os.path.join(dest_genre_dir, f"{clean_title}.json")
            target_attr = os.path.join(dest_genre_dir, f"{clean_title}_attribution.txt")

            src_audio = os.path.join(root, fn)
            shutil.move(src_audio, target_audio)
            fsize = os.path.getsize(target_audio)

            attr_text = (
                f'"{clean_title}" by {artist}\n'
                f'Provided by StreamBeats by Harris Heller (DMCA-Free Sync License)\n'
                f'https://www.streambeats.com/'
            )
            with open(target_attr, "w", encoding="utf-8") as f:
                f.write(attr_text)

            sidecar = {
                "title": clean_title,
                "artist": artist,
                "sourceName": "StreamBeats",
                "genre": genre_name,
                "bpm": "—",
                "duration": "—",
                "mood": genre_name,
                "instruments": "",
                "licenseType": "DMCA-Free Sync",
                "licenseUrl": "https://www.streambeats.com/",
                "webUrl": "https://www.streambeats.com/",
                "attribution": attr_text,
                "safeForYouTube": True
            }
            with open(target_json, "w", encoding="utf-8") as f:
                json.dump(sidecar, f, indent=2, ensure_ascii=False)

            manifest.setdefault("tracks", {})[f"streambeats-{clean_title}"] = {
                "title": clean_title,
                "artist": artist,
                "genre": genre_name,
                "localPath": target_audio,
                "sizeBytes": fsize,
                "syncedAt": datetime.now().isoformat()
            }
            ingested += 1
            print(f"  ✓ {clean_title} ({fsize / (1024*1024):.2f} MB)", flush=True)

    # Save manifest
    manifest["lastUpdated"] = datetime.now().isoformat()
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    # Clean temp dir
    try:
        shutil.rmtree(temp_base)
    except Exception:
        pass

    print(f"\n✓ Género {genre_name} completado: {ingested} pistas ingestadas.", flush=True)
    return ingested

def main():
    parser = argparse.ArgumentParser(description="StreamBeats Automated Synchronizer")
    parser.add_argument("--genre", default="Synthwave", choices=list(STREAMBEATS_GENRES.keys()) + ["All"], help="Genre to sync")
    parser.add_argument("--library-dir", default=DEFAULT_LIBRARY_DIR, help="Destination root for local music library")

    args = parser.parse_args()

    if args.genre == "All":
        for gname, info in STREAMBEATS_GENRES.items():
            sync_genre_folder(gname, info["folder_id"], args.library_dir)
    else:
        info = STREAMBEATS_GENRES[args.genre]
        sync_genre_folder(args.genre, info["folder_id"], args.library_dir)

if __name__ == "__main__":
    main()
