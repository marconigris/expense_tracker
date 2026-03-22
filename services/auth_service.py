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
AUTHENTICATOR_KEY = "_authenticator_instance"


def _convert_to_dict(obj):
    """
    Recursively convert Streamlit secret objects to plain dicts.
    Handles Streamlit's __nested_secrets__ structure.
    """
    # Handle Streamlit's nested secrets structure
    if hasattr(obj, '_secrets'):
        return _convert_to_dict(obj._secrets)
    
    if hasattr(obj, '__nested_secrets__'):
        nested = getattr(obj, '__nested_secrets__', {})
        if isinstance(nested, dict):
            return _convert_to_dict(nested)
        return nested
    
    if isinstance(obj, dict):
        return {k: _convert_to_dict(v) for k, v in obj.items()}
    elif hasattr(obj, '__dict__'):
        return _convert_to_dict(vars(obj))
    elif isinstance(obj, (list, tuple)):
        return type(obj)(_convert_to_dict(item) for item in obj)
    else:
        return obj


def _load_auth_config():
    """Load authentication config from Streamlit secrets or local file."""
    config = None

    if 'credentials' in st.secrets:
        try:
            logger.info("Attempting to load from secrets")

            cookie_raw = st.secrets.get('cookie')
            logger.info(f"Cookie type: {type(cookie_raw)}")

            cookie = _convert_to_dict(cookie_raw)
            logger.info(f"Converted cookie keys: {list(cookie.keys()) if isinstance(cookie, dict) else 'not a dict'}")

            credentials_raw = st.secrets.get('credentials')
            credentials = _convert_to_dict(credentials_raw)

            if not isinstance(cookie, dict) or 'name' not in cookie or 'key' not in cookie:
                raise ValueError(f"Invalid cookie structure: {cookie}")

            config = {
                'credentials': credentials,
                'cookie': cookie,
            }
            logger.info("Successfully loaded config from secrets")
        except Exception as secret_error:
            logger.warning(f"Failed to load from secrets: {secret_error}. Trying file fallback...")
            config = None

    if config is None:
        logger.info(f"Attempting to load from file: {CREDENTIALS_PATH}")
        with open(CREDENTIALS_PATH) as file:
            config = yaml.safe_load(file)
        logger.info("Loaded config from file")

    return config


def load_authenticator():
    """
    Load and reuse a single authenticator instance per Streamlit session.
    This avoids duplicate CookieManager components with the same key.
    """
    try:
        authenticator = st.session_state.get(AUTHENTICATOR_KEY)
        if authenticator is not None:
            return authenticator

        config = _load_auth_config()
        authenticator = stauth.Authenticate(
            config['credentials'],
            config['cookie']['name'],
            config['cookie']['key'],
            config['cookie']['expiry_days']
        )
        st.session_state[AUTHENTICATOR_KEY] = authenticator
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
