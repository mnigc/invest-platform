import requests
import os
import sys
sys.path.insert(0, '.')
from sync_base import _load_dotenv
_load_dotenv()
key = os.environ.get('FRED_API_KEY','')
# Try different search terms
for term in ['gold reserve', 'official reserve', 'IMF gold', 'central bank gold']:
    print(f"\n=== Search: {term} ===")
    url = 'https://api.stlouisfed.org/fred/series/search'
    params = {'search_text': term, 'api_key': key, 'file_type': 'json', 'limit': 10}
    r = requests.get(url, params=params, timeout=30)
    data = r.json()
    for s in data.get('seriess', []):
        print(f"  {s['id']}: {s['title']}")
