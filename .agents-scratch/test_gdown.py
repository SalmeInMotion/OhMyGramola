import gdown

url = 'https://drive.google.com/drive/folders/196AfI6vYiSwKqb7ATKKg4J_4PcwG84jC'
try:
    print("Scanning StreamBeats Google Drive folder with gdown (skip_download=True)...")
    files = gdown.download_folder(url, skip_download=True, quiet=False)
    print(f"Found {len(files)} items in StreamBeats folder!")
    for f in files[:20]:
        print(f"  - {f.name} (id: {f.id}, size: {f.size})")
except Exception as e:
    print("gdown error:", e)
