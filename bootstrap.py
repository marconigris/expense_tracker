from __future__ import annotations

from typing import Optional

import streamlit as st

from services.google_sheets import get_sheets_service, verify_sheets_setup, get_sheet_url
from utils.logging_utils import setup_logging
from state import is_sheets_verified, set_sheets_verified, init_session_state

log = setup_logging("expense_tracker_bootstrap")


def ensure_startup() -> None:
    """
    Lógica de arranque común para toda la app.
    - Inicializa session_state básico.
    - Verifica la configuración de Google Sheets solo una vez.
    """
    init_session_state()

    if not is_sheets_verified():
        log.info("Verifying Google Sheets setup...")
        verify_sheets_setup()
        set_sheets_verified(True)
        log.info("Google Sheets setup verified.")


def get_main_sheet_url() -> Optional[str]:
    """
    Devuelve la URL del Google Sheet principal, si está disponible.
    """
    try:
        return get_sheet_url()
    except Exception as e:
        log.error(f"Error getting sheet URL: {e}")
        return None


def render_global_header() -> None:
    """
    Renderiza elementos comunes en la parte superior:
    - título
    - saludo con nombre de usuario
    - enlace al Google Sheet
    """
    st.title("Chetti Accounting ❤️")
    
    # Get username from multiple possible sources
    username = None
    
    # Try Streamlit Cloud auth (st.session_state.user attribute)
    if hasattr(st.session_state, "user") and st.session_state.user:
        try:
            email = st.session_state.user.email
            username = email.split("@")[0] if email else None
            log.debug(f"Got username from st.session_state.user: {username}")
        except Exception as e:
            log.debug(f"Could not get user from st.session_state.user: {e}")
    
    # Fallback to direct st.secrets check
    if not username:
        try:
            username = st.secrets.get("USERNAME")
            if username:
                log.debug(f"Got username from st.secrets: {username}")
        except Exception as e:
            log.debug(f"Could not get USERNAME from st.secrets: {e}")
    
    # Fallback to environment variable
    if not username:
        import os
        username = os.getenv("USERNAME")
        if username:
            log.debug(f"Got username from environment: {username}")
    
    # Display greeting with username
    if username:
        st.write(f"¡Hola, **{username}**! 👋")
    else:
        log.warning("Could not determine username from any source")

    sheet_url = get_main_sheet_url()
    if sheet_url:
        st.sidebar.markdown(f"[📊 View Google Sheet]({sheet_url})")

    st.divider()
