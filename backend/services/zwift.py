import requests
import logging
import time
from requests.exceptions import RequestException

# Set up logging (simplified for Cloud Functions)
logger = logging.getLogger('ZwiftAPI')

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

