from __future__ import annotations

from typing import Optional

import streamlit as st

from services.google_sheets import get_sheet_url
from services.auth_service import render_login, render_logout, get_authenticated_username, is_authenticated
from utils.logging_utils import setup_logging
from state import init_session_state, get_current_project, set_current_project
from config.constants import PROJECTS

log = setup_logging("expense_tracker_bootstrap")


def render_sidebar_navigation() -> None:
    """Render the custom sidebar navigation shared across pages."""
    current_project = get_current_project()

    st.sidebar.markdown("### Projects")
    for project_name in PROJECTS:
        button_type = "primary" if current_project == project_name else "secondary"
        if st.sidebar.button(
            project_name,
            key=f"nav_project_{project_name}",
            use_container_width=True,
            type=button_type,
        ):
            set_current_project(project_name)
            st.switch_page("Home.py")


def render_sidebar_footer() -> None:
    """Render sidebar actions near the bottom."""
    st.sidebar.markdown(
        """
        <style>
        [data-testid="stSidebarUserContent"] {
            display: flex;
            flex-direction: column;
            min-height: 100vh;
        }

        .sidebar-footer-spacer {
            flex: 1 1 auto;
            min-height: 2rem;
        }
        </style>
        <div class="sidebar-footer-spacer"></div>
        """,
        unsafe_allow_html=True,
    )

    sheet_url = get_main_sheet_url()
    if sheet_url:
        st.sidebar.markdown(f"[📊 View Google Sheet]({sheet_url})")

    render_logout()


def ensure_startup() -> bool:
    """
    Lógica de arranque común para toda la app.
    - Verifica autenticación del usuario
    - Inicializa session_state básico.
    - Verifica la configuración de Google Sheets solo una vez.
    
    Returns:
        bool: True if user is authenticated and ready, False otherwise
    """
    # Always render login first (at the top of the app).
    # render_login() may restore the user from the authenticator cookie on refresh,
    # so we should only stop if authentication still failed after that call.
    if not is_authenticated() and not render_login():
        return False  # Stop rendering rest of app
    
    # User is authenticated, continue with normal startup
    init_session_state()
    render_sidebar_navigation()
    render_sidebar_footer()

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
    project_name = get_current_project()
    
    if username:
        st.write(f"Hola **{username}**, welcome to **{project_name}**")
    
def render_top_view_navigation(active_view: str) -> None:
    """Render the top-level page switcher between Expense and Balances."""
    selected_view = st.segmented_control(
        "View",
        ["Expense", "Balances"],
        selection_mode="single",
        default=active_view,
        key=f"top_view_navigation_{active_view.lower()}",
        label_visibility="collapsed",
    )

    if selected_view == "Balances" and active_view != "Balances":
        st.switch_page("pages/📊_Dashboard.py")
    elif selected_view == "Expense" and active_view != "Expense":
        st.switch_page("Home.py")
