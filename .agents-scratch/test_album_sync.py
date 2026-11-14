import gdown
import os
import shutil
import json
import re

# Test album: High At The Planetarium (Lofi)
album_folder_id = "1SieTPfxp07hOELuafJWQ8AugRH4AN2QI"
album_url = f"https://drive.google.com/drive/folders/{album_folder_id}"

temp_dest = r"C:\Users\AI_cachofo\AppData\Local\Temp\OhMyGramola-StreamBeats\Lofi_Album1"
os.makedirs(temp_dest, exist_ok=True)

print("Downloading album 'High At The Planetarium' with gdown...")
# Download first 5 files or whole album
files = gdown.download_folder(album_url, output=temp_dest, quiet=False)
print(f"Downloaded {len(files)} files to {temp_dest}")

library_dir = r"P:\IA\RRSS\Music\StreamBeats\Lofi"
os.makedirs(library_dir, exist_ok=True)

manifest_path = r"P:\IA\RRSS\Music\.sync_manifest.json"
manifest = {"version": 1, "lastUpdated": None, "tracks": {}}
if os.path.exists(manifest_path):
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
    except Exception:
        pass

for root, dirs, fnames in os.walk(temp_dest):
    for fn in fnames:
        ext = os.path.splitext(fn)[1].lower()
        if ext not in [".wav", ".mp3", ".flac"]:
            continue
        
        raw_base = os.path.splitext(fn)[0]
        # Clean track name (e.g. "1. Harris Heller - Path Less Traveled" -> "Path Less Traveled")
        clean_title = re.sub(r'^\d+\.\s*', '', raw_base)
        artist = "Harris Heller / StreamBeats"
        if " - " in clean_title:
            parts = clean_title.split(" - ", 1)
            artist = parts[0].strip()
            clean_title = parts[1].strip()

        dest_audio = os.path.join(library_dir, f"{clean_title}{ext}")
        dest_json = os.path.join(library_dir, f"{clean_title}.json")
        dest_attr = os.path.join(library_dir, f"{clean_title}_attribution.txt")

        src_audio = os.path.join(root, fn)
        shutil.move(src_audio, dest_audio)

        fsize = os.path.getsize(dest_audio)
        attr_text = (
            f'"{clean_title}" by {artist}\n'
            f'Provided by StreamBeats by Harris Heller (DMCA-Free Sync License)\n'
            f'https://www.streambeats.com/'
        )
        with open(dest_attr, "w", encoding="utf-8") as f:
            f.write(attr_text)

        sidecar = {
            "title": clean_title,
            "artist": artist,
            "sourceName": "StreamBeats",
            "genre": "Lofi",
            "bpm": "—",
            "duration": "—",
            "mood": "Lofi Chill",
            "instruments": "",
            "licenseType": "DMCA-Free Sync",
            "licenseUrl": "https://www.streambeats.com/",
            "webUrl": "https://www.streambeats.com/",
            "attribution": attr_text,
            "safeForYouTube": True
        }
        with open(dest_json, "w", encoding="utf-8") as f:
            json.dump(sidecar, f, indent=2, ensure_ascii=False)

        manifest.setdefault("tracks", {})[f"streambeats-{clean_title}"] = {
            "title": clean_title,
            "artist": artist,
            "genre": "Lofi",
            "localPath": dest_audio,
            "sizeBytes": fsize
        }
        print(f"  ✓ Ingested: {clean_title} ({fsize / (1024*1024):.2f} MB)")

with open(manifest_path, "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)

print("✓ Manifest updated.")
