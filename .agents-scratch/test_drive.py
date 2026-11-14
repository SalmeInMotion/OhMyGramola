import urllib.request
import re

url = 'https://drive.google.com/drive/folders/196AfI6vYiSwKqb7ATKKg4J_4PcwG84jC'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
try:
    with urllib.request.urlopen(req, timeout=15) as res:
        html = res.read().decode('utf-8')
        print("HTML length:", len(html))
        # Look for genre folder names or drive items in JavaScript payload
        # Common Google drive patterns: [id, [name], ...]
        items = re.findall(r'\["([a-zA-Z0-9_-]{28,35})",\["([^"]+)"', html)
        print("Items found:", len(items))
        for item in items[:20]:
            print(item)
except Exception as e:
    print("Error:", e)
