import gdown
import os

test_id = "1eM6-k3pOZJgKouWD3-MKg_1MwoEMsgIx"
dest = r"P:\IA\RRSS\Music\_incoming_packs\test_track.wav"
print("Testing direct track download with gdown...")
out = gdown.download(id=test_id, output=dest, quiet=False)
if out and os.path.exists(dest):
    print("✓ Success! Downloaded size:", os.path.getsize(dest))
else:
    print("✗ Failed to download track.")
