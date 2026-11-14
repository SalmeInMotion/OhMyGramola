import urllib.request
import re

req = urllib.request.Request('https://www.streambeats.com', headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
with urllib.request.urlopen(req, timeout=10) as r:
    html = r.read().decode('utf-8', errors='ignore')
    links = re.findall(r'href=["\']([^"\']+)["\']', html)
    for l in sorted(set(links)):
        if l.startswith('http') and 'streambeats.com' not in l:
            print(l)
