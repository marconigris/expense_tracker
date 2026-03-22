from __future__ import annotations

from typing import Optional

import streamlit as st

from services.google_sheets import get_sheets_service, verify_sheets_setup, get_sheet_url
from services.auth_service import render_login, render_logout, get_authenticated_username, is_authenticated
from utils.logging_utils import setup_logging
from state import is_sheets_verified, set_sheets_verified, init_session_state

log = setup_logging("expense_tracker_bootstrap")


def ensure_startup() -> bool:
    """
    Lógica de arranque común para toda la app.
    - Verifica autenticación del usuario
    - Inicializa session_state básico.
    - Verifica la configuración de Google Sheets solo una vez.
    
    Returns:
        bool: True if user is authenticated and ready, False otherwise
    """
    # Always render login first (at the top of the app)
    if not is_authenticated():
        render_login()
        return False  # Stop rendering rest of app
    
    # User is authenticated, continue with normal startup
    init_session_state()
    render_logout()  # Show logout in sidebar

    if not is_sheets_verified():
        log.info("Verifying Google Sheets setup...")
        verify_sheets_setup()
        set_sheets_verified(True)
        log.info("Google Sheets setup verified.")
    
    return True


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
    - saludo con nombre de usuario autenticado
    - enlace al Google Sheet
    """
    # Get username from authenticated session
    username = get_authenticated_username()
    
    if username:
        st.write(f"¡Hola, **{username}**! 👋")
    
    sheet_url = get_main_sheet_url()
    if sheet_url:
        st.sidebar.markdown(f"[📊 View Google Sheet]({sheet_url})")

    st.divider()
