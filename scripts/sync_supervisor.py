#!/usr/bin/env python3
"""
OhMyGramola — Autonomous Sync Supervisor & Watchdog (sync_supervisor.py)
Monitors catalog downloads and incoming pack ingestion.
Automatically resumes downloads if interrupted, handles rate limits,
and processes any ZIPs/folders dropped into _incoming_packs.
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime

PYTHON_EXE = sys.executable
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPTS_DIR, ".."))
LIBRARY_DIR = r"P:\IA\RRSS\Music"
INCOMING_DIR = os.path.join(LIBRARY_DIR, "_incoming_packs")
STOP_FILE = os.path.join(LIBRARY_DIR, ".stop_sync")
SUPERVISOR_STATUS = os.path.join(LIBRARY_DIR, ".supervisor_status.json")

def write_supervisor_status(data: dict):
    try:
        data["lastHeartbeat"] = datetime.now().isoformat()
        data["supervisorPid"] = os.getpid()
        tmp = SUPERVISOR_STATUS + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        if os.path.exists(SUPERVISOR_STATUS):
            os.remove(SUPERVISOR_STATUS)
        os.rename(tmp, SUPERVISOR_STATUS)
    except Exception:
        pass

def check_and_import_incoming():
    """Checks _incoming_packs and runs import_local_packs.py if new files exist."""
    if not os.path.exists(INCOMING_DIR):
        return
    entries = [f for f in os.listdir(INCOMING_DIR) if f.lower() != "processed" and not f.startswith(".")]
    if entries:
        print(f"[SUPERVISOR] Detectados {len(entries)} elementos en _incoming_packs. Procesando...", flush=True)
        import_script = os.path.join(SCRIPTS_DIR, "import_local_packs.py")
        subprocess.run([PYTHON_EXE, import_script], cwd=PROJECT_ROOT)

def run_sync_batch(limit=50, delay=4.0):
    """Executes a bounded batch with catalog_sync.py."""
    sync_script = os.path.join(SCRIPTS_DIR, "catalog_sync.py")
    cmd = [PYTHON_EXE, "-u", sync_script, "--limit", str(limit), "--delay", str(delay)]
    print(f"[SUPERVISOR] Iniciando lote de {limit} pistas...", flush=True)
    res = subprocess.run(cmd, cwd=PROJECT_ROOT)
    return res.returncode

def main():
    print("=== OhMyGramola Supervisor & Watchdog Iniciado ===", flush=True)
    print(f"Directorio de biblioteca: {LIBRARY_DIR}", flush=True)

    if os.path.exists(STOP_FILE):
        try:
            os.remove(STOP_FILE)
        except Exception:
            pass

    restart_count = 0
    consecutive_errors = 0

    while True:
        if os.path.exists(STOP_FILE):
            print("[SUPERVISOR] Archivo .stop_sync detectado. Deteniendo supervisor limpiamente.", flush=True)
            write_supervisor_status({"status": "stopped", "reason": "user stop flag"})
            break

        # 1. Process any manual incoming packs
        check_and_import_incoming()

        # 2. Check sync status
        sync_status_path = os.path.join(LIBRARY_DIR, ".sync_status.json")
        if os.path.exists(sync_status_path):
            try:
                with open(sync_status_path, "r", encoding="utf-8") as f:
                    st = json.load(f)
                    if st.get("status") == "completed":
                        print("[SUPERVISOR] ¡Sincronización completa alcanzada! No quedan más pistas.", flush=True)
                        write_supervisor_status({"status": "completed", "restarts": restart_count})
                        break
            except Exception:
                pass

        write_supervisor_status({
            "status": "active",
            "restarts": restart_count,
            "consecutiveErrors": consecutive_errors,
            "lastRun": datetime.now().isoformat()
        })

        # 3. Run a batch of 30 tracks
        ret_code = run_sync_batch(limit=30, delay=4.0)

        if ret_code != 0:
            consecutive_errors += 1
            print(f"[SUPERVISOR] El sincronizador terminó con código {ret_code}. Error consecutivo #{consecutive_errors}.", flush=True)
            if consecutive_errors >= 5:
                print("[SUPERVISOR] Demasiados errores consecutivos. Pausa de seguridad de 60s antes de reanudar...", flush=True)
                time.sleep(60)
            else:
                time.sleep(10)
        else:
            consecutive_errors = 0
            restart_count += 1
            print("[SUPERVISOR] Lote finalizado con éxito. Verificando estado para el siguiente lote...", flush=True)
            time.sleep(2)

    print("=== OhMyGramola Supervisor finalizado ===", flush=True)

if __name__ == "__main__":
    main()
