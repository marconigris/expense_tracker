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
    - enlace al Google Sheet
    """
    st.title("Chetti Accounting ❤️")

    sheet_url = get_main_sheet_url()
    if sheet_url:
        st.sidebar.markdown(f"[📊 View Google Sheet]({sheet_url})")

    st.divider()
