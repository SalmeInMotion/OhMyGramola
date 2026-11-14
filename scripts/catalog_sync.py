#!/usr/bin/env python3
"""
OhMyGramola — Catalog Synchronizer CLI (catalog_sync.py)
Downloads and indexes YouTube-safe music directly into P:\\IA\\RRSS\\Music.
Includes auto-retry, timeout safety, heartbeat reporting and zero-data-loss resumption.
"""

import argparse
import json
import os
import re
import shutil
import socket
import sys
import tempfile
import time
import urllib.request
import urllib.parse
from datetime import datetime

# Enforce socket timeout across all network calls
socket.setdefaulttimeout(25)

USER_AGENT = "OhMyGramola-CatalogSync/1.0"
DEFAULT_LIBRARY_DIR = r"P:\IA\RRSS\Music"
DEFAULT_DELAY = 4.0
MIN_VALID_SIZE_BYTES = 20 * 1024  # > 20 KB
MAX_RETRIES = 3

def sanitize_filename(name: str) -> str:
    s = re.sub(r'[\\/*?:"<>|]', "", name)
    s = s.strip().strip(".")
    return s if s else "Untitled"

def format_duration(seconds_val) -> str:
    try:
        total_sec = int(float(seconds_val))
        mins = total_sec // 60
        secs = total_sec % 60
        return f"{mins:02d}:{secs:02d}"
    except (ValueError, TypeError):
        return str(seconds_val) if seconds_val else "—"

def load_manifest(manifest_path: str) -> dict:
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[WARN] Error reading manifest {manifest_path}: {e}", flush=True)
    return {"version": 1, "lastUpdated": None, "tracks": {}}

def save_manifest(manifest_path: str, data: dict):
    data["lastUpdated"] = datetime.now().isoformat()
    tmp = manifest_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    if os.path.exists(manifest_path):
        os.remove(manifest_path)
    os.rename(tmp, manifest_path)

def update_status(library_dir: str, status_data: dict):
    try:
        status_path = os.path.join(library_dir, ".sync_status.json")
        status_data["lastHeartbeat"] = datetime.now().isoformat()
        status_data["pid"] = os.getpid()
        tmp = status_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(status_data, f, indent=2, ensure_ascii=False)
        if os.path.exists(status_path):
            os.remove(status_path)
        os.rename(tmp, status_path)
    except Exception:
        pass

def sync_incompetech(library_dir: str, limit: int, delay: float, dry_run: bool = False, genre_filter: str = None, bundled_dest: str = None):
    print("=== OhMyGramola: Sincronizando fuente Incompetech (Kevin MacLeod) ===", flush=True)
    
    headers = {"User-Agent": USER_AGENT}
    
    # 1. Fetch genres mapping
    url_genres = "https://incompetech.com/music/royalty-free/genre.json"
    req_g = urllib.request.Request(url_genres, headers=headers)
    with urllib.request.urlopen(req_g, timeout=15) as res:
        genres_raw = json.loads(res.read().decode("utf-8"))
    
    genre_map = {str(g["id"]): g["genre"].strip() for g in genres_raw if "id" in g and "genre" in g}
    print(f"✓ Cargados {len(genre_map)} géneros de Incompetech.", flush=True)

    # 2. Fetch pieces catalog
    url_pieces = "https://incompetech.com/music/royalty-free/pieces.json"
    req_p = urllib.request.Request(url_pieces, headers=headers)
    with urllib.request.urlopen(req_p, timeout=20) as res:
        pieces_raw = json.loads(res.read().decode("utf-8"))
    
    print(f"✓ Cargadas {len(pieces_raw)} piezas del catálogo oficial de Kevin MacLeod.", flush=True)

    if bundled_dest:
        try:
            os.makedirs(os.path.dirname(bundled_dest), exist_ok=True)
            with open(bundled_dest, "w", encoding="utf-8") as f:
                json.dump(pieces_raw, f, indent=2, ensure_ascii=False)
            print(f"✓ Catálogo offline guardado en {bundled_dest}", flush=True)
        except Exception as e:
            print(f"[WARN] No se pudo guardar el catálogo offline en {bundled_dest}: {e}", flush=True)

    # 3. Load manifest
    manifest_path = os.path.join(library_dir, ".sync_manifest.json")
    manifest = load_manifest(manifest_path)
    known_tracks = manifest.get("tracks", {})

    # Filter candidates
    candidates = []
    for p in pieces_raw:
        title = (p.get("title") or "").strip()
        if not title:
            continue
        g_id = str(p.get("genre", ""))
        genre_name = genre_map.get(g_id, "Soundtrack")
        if genre_filter and genre_name.lower() != genre_filter.lower():
            continue
        
        filename = (p.get("filename") or f"{title}.mp3").strip()
        track_id = f"incompetech-{filename}"
        
        # Check if already in manifest and file actually exists and > 20KB
        if track_id in known_tracks:
            existing_path = known_tracks[track_id].get("localPath")
            if existing_path and os.path.exists(existing_path) and os.path.getsize(existing_path) >= MIN_VALID_SIZE_BYTES:
                continue

        candidates.append((track_id, p, genre_name, filename))

    total_candidates = len(candidates)
    print(f"Pistas candidatas pendientes de descarga: {total_candidates}", flush=True)

    if total_candidates == 0:
        print("✓ ¡Todo el catálogo ya está completamente descargado e indexado!", flush=True)
        update_status(library_dir, {
            "status": "completed",
            "source": "Incompetech",
            "pendingCandidates": 0,
            "message": "All tracks synced"
        })
        return 0

    to_process = candidates[:limit] if (limit and limit > 0) else candidates
    print(f"Lote a procesar en esta ejecución: {len(to_process)} pistas (límite: {limit or 'sin límite'}, pausa: {delay}s)\n", flush=True)

    if dry_run:
        print("[DRY-RUN] Simulación completada. No se han descargado archivos.", flush=True)
        return 0

    local_temp_base = os.path.join(tempfile.gettempdir(), "OhMyGramola-Sync")
    os.makedirs(local_temp_base, exist_ok=True)

    success_count = 0
    total_downloaded_bytes = 0

    status_info = {
        "status": "running",
        "source": "Incompetech",
        "totalBatch": len(to_process),
        "processed": 0,
        "success": 0,
        "currentTrack": None,
        "currentGenre": None,
        "pendingOverall": total_candidates
    }
    update_status(library_dir, status_info)

    for idx, (track_id, p, genre_name, filename) in enumerate(to_process, 1):
        raw_title = (p.get("title") or "").strip()
        clean_title = sanitize_filename(raw_title)
        clean_genre = sanitize_filename(genre_name)

        target_dir = os.path.join(library_dir, "Incompetech", clean_genre)
        final_mp3_path = os.path.join(target_dir, f"{clean_title}.mp3")
        final_json_path = os.path.join(target_dir, f"{clean_title}.json")
        final_attr_path = os.path.join(target_dir, f"{clean_title}_attribution.txt")

        status_info["currentTrack"] = raw_title
        status_info["currentGenre"] = genre_name
        status_info["processed"] = idx
        update_status(library_dir, status_info)

        # Check existing destination
        if os.path.exists(final_mp3_path) and os.path.getsize(final_mp3_path) >= MIN_VALID_SIZE_BYTES:
            print(f"[{idx}/{len(to_process)}] [YA EXISTE] {clean_title} -> {final_mp3_path}", flush=True)
            known_tracks[track_id] = {
                "title": raw_title,
                "artist": "Kevin MacLeod",
                "genre": genre_name,
                "localPath": final_mp3_path,
                "sizeBytes": os.path.getsize(final_mp3_path),
                "syncedAt": datetime.now().isoformat()
            }
            save_manifest(manifest_path, manifest)
            continue

        encoded_fn = urllib.parse.quote(filename)
        download_url = f"https://incompetech.com/music/royalty-free/mp3-royaltyfree/{encoded_fn}"

        temp_mp3 = os.path.join(local_temp_base, f"{clean_title}.mp3.part")
        print(f"[{idx}/{len(to_process)}] Descargando: \"{raw_title}\" ({genre_name}) ...", flush=True)

        download_success = False
        file_size = 0

        # Retry loop per track
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                req_dl = urllib.request.Request(download_url, headers=headers)
                with urllib.request.urlopen(req_dl, timeout=25) as resp, open(temp_mp3, "wb") as out_f:
                    shutil.copyfileobj(resp, out_f)

                file_size = os.path.getsize(temp_mp3)
                if file_size < MIN_VALID_SIZE_BYTES:
                    print(f"  [ERROR] Intento {attempt}: archivo demasiado pequeño ({file_size} bytes).", flush=True)
                    if os.path.exists(temp_mp3):
                        os.remove(temp_mp3)
                    time.sleep(2)
                    continue

                download_success = True
                break

            except urllib.error.HTTPError as he:
                print(f"  [HTTP ERROR {he.code}] en {download_url} (Intento {attempt}/{MAX_RETRIES}): {he.reason}", flush=True)
                if he.code in (429, 503):
                    print("  [PAUSA] Esperando 20 segundos por límite temporal...", flush=True)
                    time.sleep(20)
                elif he.code == 404:
                    print(f"  [404] Pista no encontrada en servidor, saltando.", flush=True)
                    break
                else:
                    time.sleep(3)
            except Exception as e:
                print(f"  [ERROR] Intento {attempt}/{MAX_RETRIES} fallido para {raw_title}: {e}", flush=True)
                time.sleep(3)

        if not download_success:
            print(f"  ✗ Saltando pista tras {MAX_RETRIES} intentos fallidos: {raw_title}", flush=True)
            if os.path.exists(temp_mp3):
                try:
                    os.remove(temp_mp3)
                except Exception:
                    pass
            continue

        # Move atomic to library
        os.makedirs(target_dir, exist_ok=True)
        shutil.move(temp_mp3, final_mp3_path)

        # Attribution format
        attribution_text = (
            f'"{raw_title}" Kevin MacLeod (incompetech.com)\n'
            f'Licensed under Creative Commons: By Attribution 4.0 License\n'
            f'http://creativecommons.org/licenses/by/4.0/'
        )
        with open(final_attr_path, "w", encoding="utf-8") as f:
            f.write(attribution_text)

        # Sidecar JSON metadata
        web_url = p.get("filmmusicURL") or (
            f"https://incompetech.com/music/royalty-free/index.html?isrc={p.get('isrc')}"
            if p.get("isrc")
            else f"https://incompetech.com/music/royalty-free/index.html?keywords={urllib.parse.quote(raw_title)}"
        )

        sidecar_data = {
            "title": raw_title,
            "artist": "Kevin MacLeod",
            "sourceName": "Incompetech",
            "genre": genre_name,
            "bpm": str(p.get("bpm") or "—"),
            "duration": format_duration(p.get("length") or "—"),
            "mood": (p.get("feel") or "").strip(),
            "instruments": (p.get("instruments") or "").strip(),
            "licenseType": "CC BY 4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
            "webUrl": web_url,
            "attribution": attribution_text,
            "safeForYouTube": True
        }
        with open(final_json_path, "w", encoding="utf-8") as f:
            json.dump(sidecar_data, f, indent=2, ensure_ascii=False)

        total_downloaded_bytes += file_size
        success_count += 1
        status_info["success"] = success_count
        update_status(library_dir, status_info)
        print(f"  ✓ OK: {file_size / (1024*1024):.2f} MB guardado en {final_mp3_path}", flush=True)

        # Update manifest
        known_tracks[track_id] = {
            "title": raw_title,
            "artist": "Kevin MacLeod",
            "genre": genre_name,
            "localPath": final_mp3_path,
            "sizeBytes": file_size,
            "syncedAt": datetime.now().isoformat()
        }
        save_manifest(manifest_path, manifest)

        # Polite rate-limiting pause
        if idx < len(to_process):
            time.sleep(delay)

    print(f"\n=== Resumen de sincronización ===", flush=True)
    print(f"Pistas procesadas con éxito: {success_count}/{len(to_process)}", flush=True)
    print(f"Volumen transferido: {total_downloaded_bytes / (1024*1024):.2f} MB", flush=True)
    print(f"Manifiesto actualizado en: {manifest_path}", flush=True)

    status_info["status"] = "idle"
    status_info["message"] = f"Batch finished: {success_count} tracks"
    update_status(library_dir, status_info)
    return success_count

def main():
    parser = argparse.ArgumentParser(description="OhMyGramola Music Catalog Synchronizer")
    parser.add_argument("--source", default="incompetech", choices=["incompetech", "archive-cc0"], help="Music source provider")
    parser.add_argument("--limit", type=int, default=0, help="Max number of tracks to download (0 = all pending candidates)")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY, help=f"Polite delay in seconds between downloads (default: {DEFAULT_DELAY})")
    parser.add_argument("--library-dir", default=DEFAULT_LIBRARY_DIR, help="Destination root for local music library")
    parser.add_argument("--genre", default=None, help="Optional genre filter")
    parser.add_argument("--dry-run", action="store_true", help="Inspect candidates without actually downloading")
    parser.add_argument("--sync-bundled", action="store_true", help="Sync bundled incompetech_pieces.json for extension offline catalog")

    args = parser.parse_args()

    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    bundled_dest = os.path.join(project_root, "src", "data", "incompetech_pieces.json") if args.sync_bundled else None

    if args.source == "incompetech":
        sync_incompetech(
            library_dir=args.library_dir,
            limit=args.limit,
            delay=args.delay,
            dry_run=args.dry_run,
            genre_filter=args.genre,
            bundled_dest=bundled_dest
        )

if __name__ == "__main__":
    main()
