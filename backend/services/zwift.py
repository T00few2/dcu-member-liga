import requests
import logging
import time
import backoff
from requests.exceptions import RequestException
from google.protobuf.json_format import MessageToDict
from services.segment_results_pb2 import SegmentResults
from datetime import datetime

# Set up logging (simplified for Cloud Functions)
logger = logging.getLogger('ZwiftAPI')

def zwift_compat_date(dt: datetime) -> str:
    """
    Convert a datetime object to a string in the format expected by Zwift.
    """
    return dt.strftime('%Y-%m-%dT%H:%M:%SZ')

class ZwiftService:
    def __init__(self, username, password, client_id='Zwift Game Client'):
        self.username = username
        self.password = password
        self.client_id = client_id
        self.host = 'https://secure.zwift.com'
        self.token_url = f'{self.host}/auth/realms/zwift/protocol/openid-connect/token'
        self.auth_token = None
        self.refresh_token = None
        self.token_expiry_time = 0
    
    def authenticate(self):
        data = {
            'client_id': self.client_id,
            'grant_type': 'password',
            'username': self.username,
            'password': self.password
        }
        try:
            response = requests.post(self.token_url, data=data)
            if response.status_code == 200:
                self.auth_token = response.json()
                logger.info("Authenticated successfully.")
            else:
                raise Exception(f"Authentication failed: {response.text}")
            
            expires_in = self.auth_token.get('expires_in', 3600)
            self.refresh_token = self.auth_token.get('refresh_token')
            # Calculate token expiry time (with 60-second buffer)
            self.token_expiry_time = time.time() + expires_in - 60
        except Exception as e:
            print(f"Zwift Auth Error: {e}")
            raise e
        
    def refresh_auth_token(self):
        logger.info("Refreshing auth token...")
        data = {
            'client_id': self.client_id,
            'grant_type': 'refresh_token',
            'refresh_token': self.refresh_token
        }
        try:
            response = requests.post(self.token_url, data=data)
            if response.status_code == 200:
                self.auth_token = response.json()
                logger.info("Token refreshed successfully.")
                # Update refresh token and expiry time when present
                self.refresh_token = self.auth_token.get('refresh_token', self.refresh_token)
                self.token_expiry_time = time.time() + self.auth_token.get('expires_in', 60) - 60
            else:
                logger.error(f"Token refresh failed: {response.text}")
                # If refresh fails, try to authenticate again
                logger.info("Attempting to re-authenticate...")
                self.authenticate()
        except Exception as e:
            print(f"Zwift Refresh Error: {e}")
            self.authenticate() # Fallback
    
    def ensure_valid_token(self):
        """Ensure the token is valid, refresh if needed."""
        if not self.is_authenticated():
            logger.info("Not authenticated. Authenticating now.")
            self.authenticate()
        elif time.time() >= self.token_expiry_time:
            logger.info("Token expired or about to expire. Refreshing...")
            self.refresh_auth_token()
    
    def is_authenticated(self):
        return self.auth_token is not None and 'access_token' in self.auth_token

    def fetch_json_with_retry(self, url, headers, params=None):
        """Fetch JSON data with retries, handling both request and JSON parsing errors."""
        @backoff.on_exception(backoff.expo, (RequestException, ValueError), max_tries=3)
        def _fetch():
            response = requests.get(url, headers=headers, params=params, timeout=20)
            response.raise_for_status()
            return response.json()
        return _fetch()
    
    def get_profile(self, id):
        self.ensure_valid_token()
        
        headers = {
            'Authorization': f"Bearer {self.auth_token['access_token']}",
            'Accept': 'application/json'
        }
  
        url = f'https://us-or-rly101.zwift.com/api/profiles/{id}'
        try:
            response = requests.get(url, headers=headers, timeout=20)
            if response.status_code == 200:
                return response.json()
            elif response.status_code == 404:
                return None
            else:
                print(f"Zwift API Error {response.status_code}: {response.text}")
                return None
        except Exception as e:
            print(f"Zwift API Request Error: {e}")
            return None

    def get_event_info(self, event_id, event_secret=None):
        self.ensure_valid_token()
        headers = {
            'Authorization': f"Bearer {self.auth_token['access_token']}",
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }
        url = f'https://us-or-rly101.zwift.com/api/events/{event_id}'
        if event_secret:
            url += f'?eventSecret={event_secret}'
        return self.fetch_json_with_retry(url, headers=headers)

    def get_event_results(self, event_sub_id, limit=50, event_secret=None):
        self.ensure_valid_token()
        headers = {
            'Authorization': f"Bearer {self.auth_token['access_token']}",
            'Accept': 'application/json, text/plain, */*',
        }
        results_url = f'https://us-or-rly101.zwift.com/api/race-results/entries'
        
        start = 0
        all_results = []
        
        while True:
            params = {
                'event_subgroup_id': event_sub_id,
                'start': start,
                'limit': limit,
            }
            if event_secret:
                params['eventSecret'] = event_secret

            try:
                data = self.fetch_json_with_retry(results_url, headers, params)
                if 'entries' in data:
                    entries = data['entries']
                    all_results.extend(entries)
                else:
                    break
                
                if len(entries) < limit:
                    break
                start += len(entries)
                time.sleep(1) # Gentle backoff
            except Exception as e:
                print(f"Error fetching event results page: {e}")
                break
                
        return all_results

    def get_event_participants(
            self,
            event_sub_id,
            joined=False,
            limit=100,
            page=None,
            participant_type='all',
            page_delay=10,
            overlap_delay=0,
        ):
        """
        Fetch participants for a specific event subgroup with pagination.

        Notes:
        - The signed_up endpoint returns duplicates and has broken paging.
          We de-duplicate by athlete id and fetch overlapping pages to compensate.
        """
        self.ensure_valid_token()
        
        headers = {
            'Authorization': f"Bearer {self.auth_token['access_token']}",
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            # Avoid brotli responses (requests doesn't decode br by default)
            'Accept-Encoding': 'gzip, deflate',
        }
        
        participants_url = f'https://us-or-rly101.zwift.com/api/events/subgroups/entrants/{event_sub_id}'
        start = (page * limit) if page is not None else 0
        all_participants = []
        seen_ids = set()

        def merge_page(start_offset):
            params = {
                'type': participant_type,
                'participation': 'registered' if joined else 'signed_up',
                'start': start_offset,
                'limit': limit,
            }
            data = self.fetch_json_with_retry(participants_url, headers, params)
            for participant in data:
                participant_id = participant.get('id')
                if participant_id is None or participant_id not in seen_ids:
                    if participant_id is not None:
                        seen_ids.add(participant_id)
                    all_participants.append(participant)
            return data

        overlapping_starts = []
        while True:
            try:
                data = merge_page(start)
                print(f"Fetched {len(data)} participants, total so far: {len(all_participants)}.")

                if not joined and (start or len(data) == limit):
                    # Overlapping pages help compensate for broken paging on signed_up.
                    step = 20
                    for i in range(step, limit, step):
                        overlapping_starts.append(start + i)

                # Stop if fewer than limit participants are returned, indicating end of pages
                if len(data) < limit:
                    break
                start += len(data)  # Move to the next page

                if page is not None:
                    break

                if page_delay:
                    time.sleep(page_delay)  # Delay between requests

            except ValueError as e:
                print("JSON parsing error or non-JSON response:", e)
                break  # Exit loop on persistent JSON parsing errors

            except RequestException as e:
                print(f"Request error: {e}")
                break  # Exit loop on request error

        # Fetch overlapping pages (sequentially) to improve coverage.
        for overlap_start in overlapping_starts:
            try:
                merge_page(overlap_start)
                if overlap_delay:
                    time.sleep(overlap_delay)
            except (ValueError, RequestException) as e:
                print(f"Overlap fetch error: {e}")

        return all_participants

    def get_segment_results(self, segment_id, from_date=None, to_date=None):
        self.ensure_valid_token()
        headers = {
            'Authorization': f"Bearer {self.auth_token['access_token']}",
            'Content-Type': 'application/json'
        }
        
        query = {
            'world_id': 1, # Zwift usually requires this but sometimes ignores it for segment lookup
            'segment_id': segment_id,
        }
        if from_date:
            query['from'] = zwift_compat_date(from_date)
        if to_date:
            query['to'] = zwift_compat_date(to_date)
            
        url = f'https://us-or-rly101.zwift.com/api/segment-results'
        
        try:
            response = requests.get(url, headers=headers, params=query, timeout=20)
            response.raise_for_status()
            
            binary_data = response.content
            segment_results_pb = SegmentResults()
            segment_results_pb.ParseFromString(binary_data)
            return MessageToDict(segment_results_pb)
        except Exception as e:
            print(f"Error fetching segment results: {e}")
            return {}
