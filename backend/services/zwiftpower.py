import requests
from bs4 import BeautifulSoup
from collections import defaultdict
import html
from datetime import datetime
import pytz

class ZwiftPowerService:
    """
    A class to log into ZwiftPower, maintain an authenticated session,
    and fetch data from various ZwiftPower endpoints.
    """

    def __init__(self, username: str, password: str):
        """
        Initialize the ZwiftPower client. Credentials are saved and
        used during the login() flow.
        """
        self.username = username
        self.password = password
        self.session = requests.Session()
        # Spoof a common browser user agent
        self.session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 "
                "Safari/537.36"
            )
        })

    def login(self):
        """
        Performs the Zwift SSO login flow to authenticate on ZwiftPower.
        Updates self.session with the necessary cookies.
        """
        # 1) Hit ZwiftPower external login URL
        zwiftpower_login_url = (
            "https://zwiftpower.com/ucp.php?mode=login"
            "&login=external&oauth_service=oauthzpsso"
        )
        resp1 = self.session.get(zwiftpower_login_url, allow_redirects=False)
        if "Location" not in resp1.headers:
            raise RuntimeError("ZwiftPower login redirect not found.")

        # 2) Zwift SSO login page
        zwift_login_url = resp1.headers["Location"]
        resp2 = self.session.get(zwift_login_url, allow_redirects=False)

        # 3) Parse Zwift SSO form
        soup = BeautifulSoup(resp2.text, 'html.parser')
        form = soup.find('form', id='form')
        if not form or not form.get('action'):
            raise RuntimeError("Zwift login form not found or invalid.")

        action_url = form['action']  # the POST target
        payload = {
            tag['name']: tag.get('value', '')
            for tag in form.find_all('input') if tag.get('name')
        }
        payload['username'] = self.username
        payload['password'] = self.password

        if 'rememberMe' in payload:
            payload['rememberMe'] = 'on'

        # 4) POST credentials to Zwift
        resp3 = self.session.post(action_url, data=payload, allow_redirects=False)
        if "Location" not in resp3.headers:
            raise RuntimeError("Zwift login credentials likely incorrect or 2FA needed.")

        # 5) Final redirect to ZwiftPower (sets final ZwiftPower cookie)
        final_url = resp3.headers["Location"]
        resp4 = self.session.get(final_url, allow_redirects=True)

        # If we want, we can confirm by checking ZwiftPower HTML or cookies
        # for proof we're logged in. For brevity, just check status:
        if resp4.status_code != 200:
            raise RuntimeError(
                f"ZwiftPower final login redirect failed (status={resp4.status_code})"
            )

    def _format_timestamp(self, timestamp):
        """
        Convert Unix timestamp to YYYY-MM-DD HH:MM format in CEST/CET timezone
        """
        # Convert timestamp to datetime in UTC
        utc_dt = datetime.fromtimestamp(timestamp, tz=pytz.UTC)
        
        # Convert to Europe/Copenhagen timezone (CEST/CET)
        copenhagen_tz = pytz.timezone('Europe/Copenhagen')
        local_dt = utc_dt.astimezone(copenhagen_tz)
        
        # Format the date and time
        return local_dt.strftime('%Y-%m-%d %H:%M')

    def _format_time(self, seconds_float):
        """
        Convert seconds.milliseconds to hh:mm:ss.ms format
        """
        if seconds_float is None:
            return "N/A"
            
        # Split into seconds and milliseconds
        seconds = int(seconds_float)
        milliseconds = int((seconds_float - seconds) * 1000)
        
        # Calculate hours, minutes, and remaining seconds
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        remaining_seconds = seconds % 60
        
        # Format with leading zeros and milliseconds
        return f"{hours:02d}:{minutes:02d}:{remaining_seconds:02d}.{milliseconds:03d}"

    def get_rider_data_json(self, rider_id: int) -> dict:
        """
        Fetch the rider's JSON from the "cache3/profile" endpoint.
        """
        url = f"https://zwiftpower.com/cache3/profile/{rider_id}_all.json"
        resp = self.session.get(url)
        if resp.status_code == 200:
            return resp.json()
        else:
            return {}
