#!/usr/bin/env python3
"""
OhMyGramola — Local Pack Importer (import_local_packs.py)
Unpacks manual ZIP downloads (StreamBeats, Pixabay, YouTube Audio Library packs)
directly into P:\\IA\\RRSS\\Music\\<Fuente>\\<Genero>\\ and generates full OhMyGramola sidecars.
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

def process_zip_archive(zip_path: str, source_name: str, library_dir: str, default_genre: str = None) -> int:
    zip_stem = os.path.splitext(os.path.basename(zip_path))[0]
    inferred_genre = default_genre or sanitize_name(zip_stem)

    manifest_path = os.path.join(library_dir, ".sync_manifest.json")
    manifest = load_manifest(manifest_path)
    known_tracks = manifest.get("tracks", {})

    print(f"\nProcesando archivo ZIP: {zip_path}")
    print(f"  Fuente: {source_name} | Género inferido: {inferred_genre}")

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
            
            # Detect artist if separated by ' - '
            artist = "Harris Heller / StreamBeats" if source_name.lower() == "streambeats" else "Various Artists"
            track_title = clean_title
            if " - " in clean_title:
                parts = clean_title.split(" - ", 1)
                artist = parts[0].strip()
                track_title = parts[1].strip()

            final_audio = os.path.join(dest_genre_dir, f"{clean_title}{ext}")
            final_json = os.path.join(dest_genre_dir, f"{clean_title}.json")
            final_attr = os.path.join(dest_genre_dir, f"{clean_title}_attribution.txt")

            # Extract file
            with zf.open(member) as source_f, open(final_audio, "wb") as target_f:
                shutil.copyfileobj(source_f, target_f)

            fsize = os.path.getsize(final_audio)
            if fsize < MIN_VALID_SIZE_BYTES:
                os.remove(final_audio)
                continue

            # Metadata sidecar
            if source_name.lower() == "streambeats":
                attr_text = (
                    f'"{track_title}" by {artist}\n'
                    f'Provided by StreamBeats (DMCA-Free Sync License)\n'
                    f'https://www.streambeats.com/'
                )
                license_type = "DMCA-Free Sync"
                license_url = "https://www.streambeats.com/"
                web_url = "https://www.streambeats.com/"
            else:
                attr_text = (
                    f'"{track_title}" by {artist}\n'
                    f'Source: {source_name} (YouTube Monetization Safe)\n'
                )
                license_type = "Creator Safe / Royalty-Free"
                license_url = "https://www.youtube.com/audiolibrary"
                web_url = "https://www.youtube.com/audiolibrary"

            with open(final_attr, "w", encoding="utf-8") as f:
                f.write(attr_text)

            sidecar_data = {
                "title": track_title,
                "artist": artist,
                "sourceName": source_name,
                "genre": inferred_genre,
                "bpm": "—",
                "duration": "—",
                "mood": inferred_genre,
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
            known_tracks[track_id] = {
                "title": track_title,
                "artist": artist,
                "genre": inferred_genre,
                "localPath": final_audio,
                "sizeBytes": fsize,
                "importedAt": datetime.now().isoformat()
            }
            save_manifest(manifest_path, manifest)
            imported_count += 1
            print(f"  ✓ {clean_title} ({fsize / (1024*1024):.2f} MB)")

    return imported_count

def main():
    parser = argparse.ArgumentParser(description="OhMyGramola Local Pack Importer")
    parser.add_argument("--source", default="StreamBeats", help="Source collection name (default: StreamBeats)")
    parser.add_argument("--incoming-dir", default=DEFAULT_INCOMING_DIR, help=f"Folder where ZIP packs are placed (default: {DEFAULT_INCOMING_DIR})")
    parser.add_argument("--zip-file", default=None, help="Explicit path to a single ZIP file")
    parser.add_argument("--genre", default=None, help="Override genre for unpacked tracks")
    parser.add_argument("--library-dir", default=DEFAULT_LIBRARY_DIR, help="Destination local music library root")

    args = parser.parse_args()

    os.makedirs(args.incoming_dir, exist_ok=True)

    if args.zip_file:
        if not os.path.exists(args.zip_file):
            print(f"Error: no existe el archivo {args.zip_file}")
            sys.exit(1)
        count = process_zip_archive(args.zip_file, args.source, args.library_dir, args.genre)
        print(f"\nImportación completada: {count} pistas importadas.")
        return

    # Scan incoming directory for .zip
    zips = [os.path.join(args.incoming_dir, f) for f in os.listdir(args.incoming_dir) if f.lower().endswith(".zip")]
    if not zips:
        print(f"No se han encontrado archivos .zip en {args.incoming_dir}")
        print("Para importar packs descargados manualmente:")
        print(f"1. Deposita tus archivos ZIP (ej. Lo-Fi.zip, Synthwave.zip) en: {args.incoming_dir}")
        print(f"2. Ejecuta este script: python scripts/import_local_packs.py --source StreamBeats")
        return

    total_imported = 0
    processed_dir = os.path.join(args.incoming_dir, "processed")
    os.makedirs(processed_dir, exist_ok=True)

    for zp in zips:
        cnt = process_zip_archive(zp, args.source, args.library_dir, args.genre)
        total_imported += cnt
        # Move processed zip
        dest_zp = os.path.join(processed_dir, os.path.basename(zp))
        if os.path.exists(dest_zp):
            os.remove(dest_zp)
        shutil.move(zp, dest_zp)

    print(f"\n=== Total importado desde ZIPs: {total_imported} pistas ===")

if __name__ == "__main__":
    main()
