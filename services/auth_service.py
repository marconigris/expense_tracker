"""
Authentication service using streamlit-authenticator.
Manages user login and session state.
"""

import streamlit as st
import streamlit_authenticator as stauth
import yaml
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Path to credentials file
CREDENTIALS_PATH = Path(__file__).parent.parent / "config" / "auth_users.yaml"


def _convert_to_dict(obj):
    """
    Recursively convert Streamlit secret objects to plain dicts.
    """
    if isinstance(obj, dict):
        return {k: _convert_to_dict(v) for k, v in obj.items()}
    elif hasattr(obj, '__dict__'):
        return _convert_to_dict(obj.__dict__)
    elif isinstance(obj, (list, tuple)):
        return type(obj)(_convert_to_dict(item) for item in obj)
    else:
        return obj


def load_authenticator():
    """
    Load the authenticator with user credentials from secrets or file.
    """
    try:
        config = None
        
        # Try to load from Streamlit secrets first (production)
        if 'credentials' in st.secrets:
            try:
                # Convert Streamlit secrets to plain dict recursively
                secrets_dict = _convert_to_dict(dict(st.secrets))
                
                logger.info(f"Secrets loaded. Keys: {list(secrets_dict.keys())}")
                
                # Validate structure
                if 'cookie' not in secrets_dict:
                    raise KeyError("'cookie' section not found in secrets")
                if 'credentials' not in secrets_dict:
                    raise KeyError("'credentials' section not found in secrets")
                
                cookie = secrets_dict.get('cookie', {})
                if not isinstance(cookie, dict):
                    logger.error(f"Cookie is not a dict: {type(cookie)}")
                    raise ValueError("Cookie must be a dictionary")
                
                if 'name' not in cookie:
                    raise KeyError(f"'name' not in cookie. Cookie keys: {list(cookie.keys())}")
                if 'key' not in cookie:
                    raise KeyError(f"'key' not in cookie. Cookie keys: {list(cookie.keys())}")
                
                config = {
                    'credentials': secrets_dict['credentials'],
                    'cookie': cookie
                }
                logger.info("Successfully loaded config from secrets")
            except Exception as secret_error:
                logger.warning(f"Failed to load from secrets: {secret_error}. Trying file fallback...")
                config = None
        
        # Fallback to file if secrets failed or not available
        if config is None:
            with open(CREDENTIALS_PATH) as file:
                config = yaml.safe_load(file)
            logger.info("Loaded config from file")
        
        # Initialize authenticator
        authenticator = stauth.Authenticate(
            config['credentials'],
            config['cookie']['name'],
            config['cookie']['key'],
            config['cookie']['expiry_days']
        )
        return authenticator
    except FileNotFoundError:
        logger.error(f"Credentials file not found at {CREDENTIALS_PATH}")
        raise
    except Exception as e:
        logger.error(f"Error loading authenticator: {e}")
        raise


def render_login() -> bool:
    """
    Render the login widget.
    
    Returns:
        bool: True if user is authenticated, False otherwise
    """
    try:
        authenticator = load_authenticator()
        authenticator.login('main')
        
        # Check if user is authenticated
        if st.session_state.get("authentication_status"):
            return True
        elif st.session_state.get("authentication_status") is False:
            st.error('Username/password is incorrect')
            return False
        else:
            st.warning('Please enter your username and password')
            return False
            
    except Exception as e:
        logger.error(f"Login error: {e}")
        st.error(f"Authentication error: {e}")
        return False


def get_authenticated_username() -> str:
    """
    Get the username of the authenticated user.
    
    Returns:
        str: Username if authenticated, empty string otherwise
    """
    if st.session_state.get("authentication_status"):
        return st.session_state.get("username", "")
    return ""


def render_logout():
    """
    Render the logout button in the sidebar.
    """
    try:
        authenticator = load_authenticator()
        authenticator.logout('logout', 'sidebar')
    except Exception as e:
        logger.error(f"Logout error: {e}")


def is_authenticated() -> bool:
    """
    Check if user is authenticated.
    
    Returns:
        bool: True if authenticated, False otherwise
    """
    return st.session_state.get("authentication_status", False)
