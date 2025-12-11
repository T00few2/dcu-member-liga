import requests
from bs4 import BeautifulSoup

# Test the clubs scraping
response = requests.get('https://dcumedlem.sportstiming.dk/clubs', timeout=10)
response.raise_for_status()

soup = BeautifulSoup(response.content, 'html.parser')
table = soup.find('table')

if not table:
    print("ERROR: Could not find clubs table")
else:
    rows = table.find_all('tr')[1:]  # Skip header
    
    clubs = []
    for row in rows:
        cols = row.find_all('td')
        if len(cols) >= 3:
            club_name = cols[0].get_text(strip=True)
            district = cols[1].get_text(strip=True)
            club_type = cols[2].get_text(strip=True)
            
            clubs.append({
                'name': club_name,
                'district': district,
                'type': club_type
            })
    
    print(f"✓ Successfully scraped {len(clubs)} clubs from DCU website")
    print("\nSample clubs:")
    for club in clubs[:5]:
        print(f"  - {club['name']} ({club['type']}, {club['district']})")

