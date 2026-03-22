from __future__ import annotations

from typing import Optional

import streamlit as st
import streamlit.components.v1 as components

from services.google_sheets import get_sheet_url
from services.auth_service import render_login, render_logout, get_authenticated_username, is_authenticated
from services.project_summary import get_personal_account_summary, get_shared_account_summary
from ui_styles import inject_global_styles
from utils.logging_utils import setup_logging
from state import (
    init_session_state,
    get_current_project,
    set_current_project,
    set_sidebar_autoclose_pending,
    consume_sidebar_autoclose,
)
from config.constants import (
    DEFAULT_PROJECT,
    get_visible_projects,
    is_personal_project,
    is_private_flow_project,
    is_business_project,
    get_project_config,
)

log = setup_logging("expense_tracker_bootstrap")


def render_sidebar_navigation() -> None:
    """Render the custom sidebar navigation shared across pages."""
    current_project = get_current_project()
    username = get_authenticated_username()
    visible_projects = get_visible_projects(username)

    if current_project not in visible_projects:
        fallback_project = visible_projects[0] if visible_projects else DEFAULT_PROJECT
        set_current_project(fallback_project)
        current_project = fallback_project

    shared_projects = [project for project in visible_projects if not is_private_flow_project(project)]
    private_projects = [project for project in visible_projects if is_personal_project(project)]
    business_projects = [project for project in visible_projects if is_business_project(project)]

    def _render_project_buttons(project_names: list[str]) -> None:
        for project_name in project_names:
            button_type = "primary" if current_project == project_name else "secondary"
            if st.sidebar.button(
                project_name,
                key=f"nav_project_{project_name}",
                width="stretch",
                type=button_type,
            ):
                set_current_project(project_name)
                set_sidebar_autoclose_pending(True)
                st.switch_page("Home.py")

    if shared_projects:
        st.sidebar.markdown("### Shared Spaces")
        _render_project_buttons(shared_projects)

    if private_projects:
        st.sidebar.markdown("### Private Ledgers")
        _render_project_buttons(private_projects)

    if business_projects:
        st.sidebar.markdown("### Business")
        _render_project_buttons(business_projects)

    if username == "marconigris":
        st.sidebar.markdown("### Dashboards")
        if st.sidebar.button(
            "Private Dashboard",
            key="nav_private_dashboard",
            width="stretch",
            type="secondary",
        ):
            set_sidebar_autoclose_pending(True)
            st.switch_page("pages/🔒_Private_Dashboard.py")

        st.sidebar.markdown("### Workflows")
        if st.sidebar.button(
            "Imports",
            key="nav_imports",
            width="stretch",
            type="secondary",
        ):
            set_sidebar_autoclose_pending(True)
            st.switch_page("pages/📥_Imports.py")
        if st.sidebar.button(
            "Classify Imports",
            key="nav_classify_imports",
            width="stretch",
            type="secondary",
        ):
            set_sidebar_autoclose_pending(True)
            st.switch_page("pages/🧾_Classify_Imports.py")


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
    init_session_state()
    inject_global_styles()

    # Always render login first (at the top of the app).
    # render_login() may restore the user from the authenticator cookie on refresh,
    # so we should only stop if authentication still failed after that call.
    if not is_authenticated() and not render_login():
        return False  # Stop rendering rest of app
    
    # User is authenticated, continue with normal startup
    render_sidebar_navigation()
    render_sidebar_footer()
    _render_sidebar_autoclose_script()

    return True


def _render_sidebar_autoclose_script() -> None:
    """Collapse the Streamlit sidebar once after a sidebar navigation click."""
    should_close, event_count = consume_sidebar_autoclose()
    if not should_close:
        return

    components.html(
        f"""
        <script>
        const sidebarAutoCloseEvent = {event_count};
        const selectors = [
          'button[aria-label="Close sidebar"]',
          'button[data-testid="stSidebarCollapseButton"]',
          '[data-testid="stSidebarCollapseButton"] button',
          'button[kind="header"][aria-label*="sidebar"]'
        ];

        const collapseSidebar = () => {{
          const parentDocument = window.parent.document;
          const collapseButton = selectors
            .map((selector) => parentDocument.querySelector(selector))
            .find(Boolean);

          if (collapseButton) {{
            collapseButton.click();
          }}
        }};

        window.setTimeout(collapseSidebar, 80);
        console.debug("sidebar-autoclose", sidebarAutoCloseEvent);
        </script>
        """,
        height=0,
    )


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
        if is_business_project(project_name):
            project_mode = "Business Ledger"
        elif is_private_flow_project(project_name):
            project_mode = "Private Ledger"
        else:
            project_mode = "Shared Expense Space"
        st.markdown(
            f"""
            <div class="hero-header">
                <div>
                    <div class="hero-header__title">{project_name}</div>
                    <div class="hero-header__subtitle">Hola {username}, everything for this project lives in one calm workspace.</div>
                </div>
                <div class="hero-badge">{project_mode}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
    
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


def _get_currency_symbol(currency: str) -> str:
    return {
        "USD": "$",
        "EUR": "€",
        "DOP": "RD$",
        "ARS": "ARS$",
        "ZAR": "R",
    }.get(currency, f"{currency} ")


def _format_currency(amount: float, currency: str) -> str:
    return f"{_get_currency_symbol(currency)}{amount:,.2f}"


def render_project_balance_banner(project_name: str) -> None:
    project_currency = get_project_config(project_name)["default_currency"]
    try:
        if is_private_flow_project(project_name):
            summary = get_personal_account_summary(project_name)
            banner_label = "Total Balance"
            balance_value = _format_currency(float(summary["net_balance"]), str(summary["currency"]))
            meta_values = [
                f"Income {_format_currency(float(summary['income_total']), str(summary['currency']))}",
                f"Expenses {_format_currency(float(summary['expense_total']), str(summary['currency']))}",
            ]
        else:
            summary = get_shared_account_summary(project_name)
            banner_label = "Total Expenses"
            balance_value = _format_currency(float(summary["total_expense"]), str(summary["currency"]))
            meta_values = [
                f"Marco {_format_currency(float(summary['marco_paid']), str(summary['currency']))}",
                f"Moni {_format_currency(float(summary['moni_paid']), str(summary['currency']))}",
                str(summary["settlement_message"]),
            ]
    except Exception as error:
        log.warning("Failed to load project summary for %s: %s", project_name, error)
        balance_value = _format_currency(0.0, project_currency)
        if is_private_flow_project(project_name):
            banner_label = "Total Balance"
            meta_values = [
                f"Income {_format_currency(0.0, project_currency)}",
                f"Expenses {_format_currency(0.0, project_currency)}",
            ]
        else:
            banner_label = "Total Expenses"
            meta_values = [
                f"Marco {_format_currency(0.0, project_currency)}",
                f"Moni {_format_currency(0.0, project_currency)}",
                "Marco and Moni are settled up",
            ]

    st.markdown(
        f"""
        <style>
        .account-balance-banner {{
            margin: 0.45rem 0 1rem;
            padding: 1.15rem 1.2rem;
            border-radius: 1.5rem;
            background:
                radial-gradient(circle at top left, rgba(255,255,255,0.2), transparent 35%),
                linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%);
            color: #f8fafc;
            box-shadow: 0 22px 48px rgba(15, 23, 42, 0.22);
        }}

        .account-balance-label {{
            font-size: 0.78rem;
            font-weight: 700;
            letter-spacing: 0.11em;
            text-transform: uppercase;
            opacity: 0.72;
        }}

        .account-balance-value {{
            margin-top: 0.25rem;
            font-size: 2.15rem;
            line-height: 1;
            font-weight: 800;
            letter-spacing: -0.05em;
        }}

        .account-balance-meta {{
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
            margin-top: 0.8rem;
            font-size: 0.95rem;
            font-weight: 600;
            opacity: 0.9;
        }}

        .account-balance-meta span {{
            white-space: nowrap;
        }}

        @media (max-width: 640px) {{
            .account-balance-banner {{
                border-radius: 1.25rem;
                padding: 1rem;
            }}

            .account-balance-value {{
                font-size: 1.8rem;
            }}
        }}
        </style>
        <div class="account-balance-banner">
            <div class="account-balance-label">{banner_label}</div>
            <div class="account-balance-value">{balance_value}</div>
            <div class="account-balance-meta">
                {''.join(f'<span>{value}</span>' for value in meta_values)}
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
