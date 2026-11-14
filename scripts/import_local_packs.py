#!/usr/bin/env python3
"""
OhMyGramola — Local Pack & Track Importer (import_local_packs.py)
Processes ZIP downloads, unpacked folders, and loose audio files dropped into
P:\\IA\\RRSS\\Music\\_incoming_packs (or custom paths), organizing them into
P:\\IA\\RRSS\\Music\\<Fuente>\\<Genero>\\ and generating full OhMyGramola sidecars (.json y _attribution.txt).
"""

import argparse
import json
import os
import re
import shutil
import sys
import zipfile
from datetime import datetime

DEFAULT_LIBRARY_DIR = r"P:\IA\RRSS\Music"
DEFAULT_INCOMING_DIR = os.path.join(DEFAULT_LIBRARY_DIR, "_incoming_packs")
AUDIO_EXTS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}
MIN_VALID_SIZE_BYTES = 20 * 1024

def sanitize_name(name: str) -> str:
    s = re.sub(r'[\\/*?:"<>|]', "", name)
    s = s.strip().strip(".")
    return s if s else "Untitled"

def load_manifest(manifest_path: str) -> dict:
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"version": 1, "lastUpdated": None, "tracks": {}}

def save_manifest(manifest_path: str, data: dict):
    data["lastUpdated"] = datetime.now().isoformat()
    tmp = manifest_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    if os.path.exists(manifest_path):
        os.remove(manifest_path)
    os.rename(tmp, manifest_path)

def create_sidecars(dest_dir: str, clean_title: str, artist: str, source_name: str, genre: str, ext: str, audio_path: str, fsize: int, manifest: dict, manifest_path: str):
    final_json = os.path.join(dest_dir, f"{clean_title}.json")
    final_attr = os.path.join(dest_dir, f"{clean_title}_attribution.txt")

    if source_name.lower() == "streambeats":
        attr_text = (
            f'"{clean_title}" by {artist}\n'
            f'Provided by StreamBeats by Harris Heller (DMCA-Free Sync License)\n'
            f'https://www.streambeats.com/'
        )
        license_type = "DMCA-Free Sync"
        license_url = "https://www.streambeats.com/"
        web_url = "https://www.streambeats.com/"
    elif "pixabay" in source_name.lower():
        attr_text = (
            f'"{clean_title}" by {artist}\n'
            f'Source: Pixabay Content License (Free for commercial use, no attribution required)\n'
            f'https://pixabay.com/music/'
        )
        license_type = "Pixabay License"
        license_url = "https://pixabay.com/service/license-summary/"
        web_url = "https://pixabay.com/music/"
    elif "youtube" in source_name.lower() or "audio library" in source_name.lower():
        attr_text = (
            f'"{clean_title}" by {artist}\n'
            f'Source: YouTube Audio Library (Royalty Free for YouTube Monetization)\n'
            f'https://studio.youtube.com/'
        )
        license_type = "YouTube Audio Library License"
        license_url = "https://support.google.com/youtube/answer/3376882"
        web_url = "https://studio.youtube.com/"
    else:
        attr_text = (
            f'"{clean_title}" by {artist}\n'
            f'Source: {source_name} (YouTube Monetization Safe)\n'
        )
        license_type = "Creator Safe / Royalty-Free"
        license_url = "https://creativecommons.org/publicdomain/zero/1.0/"
        web_url = ""

    with open(final_attr, "w", encoding="utf-8") as f:
        f.write(attr_text)

    sidecar_data = {
        "title": clean_title,
        "artist": artist,
        "sourceName": source_name,
        "genre": genre,
        "bpm": "—",
        "duration": "—",
        "mood": genre,
        "instruments": "",
        "licenseType": license_type,
        "licenseUrl": license_url,
        "webUrl": web_url,
        "attribution": attr_text,
        "safeForYouTube": True
    }

    with open(final_json, "w", encoding="utf-8") as f:
        json.dump(sidecar_data, f, indent=2, ensure_ascii=False)

    track_id = f"{source_name.lower()}-{clean_title}"
    manifest.setdefault("tracks", {})[track_id] = {
        "title": clean_title,
        "artist": artist,
        "genre": genre,
        "localPath": audio_path,
        "sizeBytes": fsize,
        "importedAt": datetime.now().isoformat()
    }
    save_manifest(manifest_path, manifest)

def process_single_audio_file(file_path: str, source_name: str, library_dir: str, default_genre: str = None) -> bool:
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in AUDIO_EXTS:
        return False

    raw_base = os.path.splitext(os.path.basename(file_path))[0]
    clean_title = sanitize_name(raw_base)
    inferred_genre = default_genre or "General"
    artist = "Harris Heller / StreamBeats" if source_name.lower() == "streambeats" else "Various Artists"

    if " - " in clean_title:
        parts = clean_title.split(" - ", 1)
        artist = parts[0].strip()
        clean_title = parts[1].strip()

    dest_genre_dir = os.path.join(library_dir, source_name, inferred_genre)
    os.makedirs(dest_genre_dir, exist_ok=True)

    final_audio = os.path.join(dest_genre_dir, f"{clean_title}{ext}")
    shutil.move(file_path, final_audio)

    fsize = os.path.getsize(final_audio)
    if fsize < MIN_VALID_SIZE_BYTES:
        os.remove(final_audio)
        return False

    manifest_path = os.path.join(library_dir, ".sync_manifest.json")
    manifest = load_manifest(manifest_path)
    create_sidecars(dest_genre_dir, clean_title, artist, source_name, inferred_genre, ext, final_audio, fsize, manifest, manifest_path)
    print(f"  ✓ Importado archivo suelto: {clean_title} -> {dest_genre_dir}")
    return True

def process_zip_archive(zip_path: str, source_name: str, library_dir: str, default_genre: str = None) -> int:
    zip_stem = os.path.splitext(os.path.basename(zip_path))[0]
    inferred_genre = default_genre or sanitize_name(zip_stem)

    manifest_path = os.path.join(library_dir, ".sync_manifest.json")
    manifest = load_manifest(manifest_path)

    print(f"\nProcesando archivo ZIP: {zip_path}")
    print(f"  Fuente: {source_name} | Género: {inferred_genre}")

    dest_genre_dir = os.path.join(library_dir, source_name, inferred_genre)
    os.makedirs(dest_genre_dir, exist_ok=True)

    imported_count = 0

    with zipfile.ZipFile(zip_path, "r") as zf:
        for member in zf.infolist():
            if member.is_dir():
                continue
            ext = os.path.splitext(member.filename)[1].lower()
            if ext not in AUDIO_EXTS:
                continue

            raw_base = os.path.splitext(os.path.basename(member.filename))[0]
            clean_title = sanitize_name(raw_base)
            
            artist = "Harris Heller / StreamBeats" if source_name.lower() == "streambeats" else "Various Artists"
            track_title = clean_title
            if " - " in clean_title:
                parts = clean_title.split(" - ", 1)
                artist = parts[0].strip()
                track_title = parts[1].strip()

            final_audio = os.path.join(dest_genre_dir, f"{track_title}{ext}")

            with zf.open(member) as source_f, open(final_audio, "wb") as target_f:
                shutil.copyfileobj(source_f, target_f)

            fsize = os.path.getsize(final_audio)
            if fsize < MIN_VALID_SIZE_BYTES:
                os.remove(final_audio)
                continue

            create_sidecars(dest_genre_dir, track_title, artist, source_name, inferred_genre, ext, final_audio, fsize, manifest, manifest_path)
            imported_count += 1
            print(f"  ✓ {track_title} ({fsize / (1024*1024):.2f} MB)")

    return imported_count

def process_incoming_directory(incoming_dir: str, source_name: str, library_dir: str) -> int:
    total_count = 0
    processed_dir = os.path.join(incoming_dir, "processed")
    os.makedirs(processed_dir, exist_ok=True)

    entries = os.listdir(incoming_dir)
    for entry in entries:
        if entry.lower() == "processed" or entry.startswith("."):
            continue
        full_path = os.path.join(incoming_dir, entry)

        # 1. ZIP files
        if os.path.isfile(full_path) and entry.lower().endswith(".zip"):
            cnt = process_zip_archive(full_path, source_name, library_dir)
            total_count += cnt
            dest_zp = os.path.join(processed_dir, entry)
            if os.path.exists(dest_zp):
                os.remove(dest_zp)
            shutil.move(full_path, dest_zp)

        # 2. Loose audio files
        elif os.path.isfile(full_path):
            ext = os.path.splitext(entry)[1].lower()
            if ext in AUDIO_EXTS:
                ok = process_single_audio_file(full_path, source_name, library_dir)
                if ok:
                    total_count += 1

        # 3. Subdirectories (e.g. dropped folder "Synthwave" with mp3s)
        elif os.path.isdir(full_path):
            genre_name = sanitize_name(entry)
            sub_count = 0
            for root, dirs, files in os.walk(full_path):
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    if ext in AUDIO_EXTS:
                        fpath = os.path.join(root, f)
                        ok = process_single_audio_file(fpath, source_name, library_dir, default_genre=genre_name)
                        if ok:
                            sub_count += 1
            total_count += sub_count
            # Move whole folder to processed
            dest_dir = os.path.join(processed_dir, entry)
            if os.path.exists(dest_dir):
                shutil.rmtree(dest_dir)
            shutil.move(full_path, dest_dir)

    return total_count

def main():
    parser = argparse.ArgumentParser(description="OhMyGramola Local Pack & Track Importer")
    parser.add_argument("--source", default="StreamBeats", help="Source collection name (StreamBeats, Pixabay, YouTube, etc.)")
    parser.add_argument("--incoming-dir", default=DEFAULT_INCOMING_DIR, help=f"Folder where ZIPs or loose files are placed (default: {DEFAULT_INCOMING_DIR})")
    parser.add_argument("--zip-file", default=None, help="Explicit path to a single ZIP file")
    parser.add_argument("--genre", default=None, help="Override genre for unpacked tracks")
    parser.add_argument("--library-dir", default=DEFAULT_LIBRARY_DIR, help="Destination local music library root")

    args = parser.parse_args()
    os.makedirs(args.incoming_dir, exist_ok=True)

    if args.zip_file:
        if not os.path.exists(args.zip_file):
            print(f"Error: no existe el archivo {args.zip_file}")
            sys.exit(1)
        cnt = process_zip_archive(args.zip_file, args.source, args.library_dir, args.genre)
        print(f"\nImportación completada: {cnt} pistas importadas.")
        return

    imported = process_incoming_directory(args.incoming_dir, args.source, args.library_dir)
    if imported == 0:
        print(f"Bandeja de entrada vacía: no hay archivos nuevos en {args.incoming_dir}")
        print("Puedes depositar:")
        print("  - Archivos .zip (ej. Lo-Fi.zip, Synthwave.zip)")
        print("  - Carpetas con canciones (ej. carpeta 'Rock' con varios .mp3)")
        print("  - Canciones sueltas .mp3, .wav, .flac")
    else:
        print(f"\n=== Total importado a la biblioteca local: {imported} pistas ===")

if __name__ == "__main__":
    main()
