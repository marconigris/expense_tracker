from __future__ import annotations

import datetime as dt

import streamlit as st

from utils.logging_utils import setup_logging
from bootstrap import ensure_startup, render_global_header
from services.google_sheets import append_transactions
from services.auth_service import get_authenticated_username
from config.exchange_rates import convert_to_usd
from config.constants import CATEGORIES

log = setup_logging("expense_tracker_home")

USER_DISPLAY_NAMES = {
    "marconigris": "Marco",
    "monigila": "Moni",
}


# ---------- UI HELPERS ----------

def _render_currency_selector() -> str:
    """Render the currency picker as native segmented buttons."""
    return st.segmented_control(
        "Currency",
        ["USD", "EUR", "DOP"],
        default="USD",
        selection_mode="single",
        key="expense_currency",
    )


def _render_split_summary(marco_share: int, moni_share: int) -> None:
    st.markdown(
        f"""
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0.75rem;margin-top:0.4rem;">
            <div style="border-radius:1rem;padding:0.9rem;background:#ffffff;border:1px solid rgba(15,23,42,0.08);">
                <div style="font-size:0.75rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.65;">Marco</div>
                <div style="font-size:1.25rem;font-weight:800;letter-spacing:-0.03em;">{marco_share}%</div>
            </div>
            <div style="border-radius:1rem;padding:0.9rem;background:#ffffff;border:1px solid rgba(15,23,42,0.08);">
                <div style="font-size:0.75rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.65;">Moni</div>
                <div style="font-size:1.25rem;font-weight:800;letter-spacing:-0.03em;">{moni_share}%</div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def _render_mobile_form_styles() -> None:
    """Keep the add-expense form compact and touch-friendly on mobile."""
    st.markdown(
        """
        <style>
        div[data-testid="stForm"] {
            border: none;
            padding: 0;
            background: transparent;
        }

        .expense-shell {
            display: grid;
            gap: 0.9rem;
            margin: 0.75rem 0 1rem;
        }

        .expense-hero {
            border-radius: 1.6rem;
            padding: 1rem 1rem 1.1rem;
            background: linear-gradient(180deg, #101828 0%, #1f2937 100%);
            color: #f8fafc;
            box-shadow: 0 20px 44px rgba(15, 23, 42, 0.18);
        }

        .expense-hero-kicker {
            font-size: 0.76rem;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            opacity: 0.72;
            margin-bottom: 0.35rem;
        }

        .expense-hero-title {
            font-size: 1.65rem;
            line-height: 1.05;
            font-weight: 800;
            letter-spacing: -0.04em;
        }

        .expense-card {
            border-radius: 1.6rem;
            padding: 0.2rem 0.3rem 0.4rem;
            background: linear-gradient(180deg, #ffffff 0%, #f4f6fb 100%);
            border: 1px solid rgba(15, 23, 42, 0.08);
            box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
        }

        div[data-testid="stNumberInput"] button {
            display: none;
        }

        div[data-testid="stNumberInput"],
        div[data-testid="stTextInput"],
        div[data-testid="stSelectbox"],
        div[data-testid="stSegmentedControl"],
        div[data-testid="stCheckbox"] {
            padding-top: 0.25rem;
        }

        div[data-testid="stNumberInput"] input,
        div[data-testid="stTextInput"] input {
            border-radius: 1rem;
            background: #ffffff;
        }

        div[data-baseweb="select"] > div {
            border-radius: 1rem;
            background: #ffffff;
        }

        div[data-testid="stFormSubmitButton"] button {
            min-height: 3.15rem;
            border-radius: 999px;
            background: linear-gradient(180deg, #111827 0%, #1f2937 100%);
            color: #f8fafc;
            border: none;
            font-weight: 700;
            box-shadow: 0 14px 26px rgba(15, 23, 42, 0.16);
        }

        details {
            border-radius: 1.1rem;
            background: rgba(255, 255, 255, 0.76);
            border: 1px solid rgba(15, 23, 42, 0.08);
            padding: 0.35rem 0.8rem;
        }

        details summary {
            font-weight: 700;
        }

        div[data-testid="stNumberInput"] input::-webkit-outer-spin-button,
        div[data-testid="stNumberInput"] input::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }

        div[data-testid="stNumberInput"] input[type="number"] {
            -moz-appearance: textfield;
        }

        @media (max-width: 640px) {
            .expense-hero,
            .expense-card {
                border-radius: 1.3rem;
            }

            .expense-hero-title {
                font-size: 1.45rem;
            }

            div[data-testid="stSegmentedControl"] button {
                min-height: 2.75rem;
            }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def _render_expense_intro() -> None:
    st.markdown(
        """
        <div class="expense-shell">
            <div class="expense-hero">
                <div class="expense-hero-kicker">Quick Add</div>
                <div class="expense-hero-title">Track an expense in a few taps</div>
            </div>
            <div class="expense-card">
        """,
        unsafe_allow_html=True,
    )


def _close_expense_card() -> None:
    st.markdown("</div></div>", unsafe_allow_html=True)


def render_add_expense_form() -> None:
    """Render the form to add a new expense."""
    _render_mobile_form_styles()
    _render_expense_intro()
    
    # Get username from authenticated session
    username = get_authenticated_username()
    expense_categories = CATEGORIES["Expense"]
    
    with st.form(key="add_expense_form", clear_on_submit=True):
        col1, col2 = st.columns([0.7, 1.3], gap="medium")
        
        with col1:
            amount = st.number_input(
                "Amount",
                min_value=0.0,
                value=None,
                step=0.01,
                format="%.2f",
                placeholder="Enter amount",
            )
        
        with col2:
            currency = _render_currency_selector()

        col3, col4 = st.columns([1, 1.1], gap="medium")
        with col3:
            category = st.selectbox(
                "Category",
                list(expense_categories.keys()),
                key="expense_category",
            )

        description = st.text_input(
            "Description",
            placeholder="e.g., Groceries, Gas, Coffee"
        )

        normalized_user = username.strip().lower() if username else ""
        with st.expander("Split details (optional)", expanded=False):
            shared_expense = st.checkbox("Shared expense", value=False, key="shared_expense")
            if shared_expense:
                marco_share = st.slider("Marco share", min_value=0, max_value=100, value=50, key="marco_share")
                moni_share = 100 - marco_share
                _render_split_summary(marco_share, moni_share)
            elif normalized_user == "marconigris":
                marco_share = 100
                moni_share = 0
            elif normalized_user == "monigila":
                marco_share = 0
                moni_share = 100
            else:
                marco_share = 0
                moni_share = 0
        
        submitted = st.form_submit_button("✅ Add Expense", use_container_width=True)
        
        if submitted:
            if amount and amount > 0 and description and username:
                _save_expense(
                    amount,
                    description,
                    currency,
                    category,
                    username,
                    marco_share,
                    moni_share,
                )
            elif amount is None:
                st.error("Please enter an amount")
            elif amount == 0:
                st.error("Please enter an amount greater than 0")
            elif not description:
                st.error("Please enter a description")
            else:
                st.error("No user authenticated. Please log in.")

    _close_expense_card()


def _save_expense(
    amount: float,
    description: str,
    currency: str,
    category: str,
    user: str,
    marco_share: int,
    moni_share: int,
) -> None:
    """Save expense to Google Sheets with currency conversion."""
    try:
        today = dt.date.today().isoformat()
        
        # Convert the input amount to USD
        usd_amount = convert_to_usd(amount, currency)
        
        values = [[
            today,                          # Date
            round(usd_amount, 2),          # Amount (converted to USD)
            "Expense",                     # Type (default)
            category,                      # Category
            description,                   # Description
            amount,                        # Currency Amount (original input)
            currency,                      # Currency
            user,                          # User
            marco_share,                   # Marco Split %
            moni_share,                    # Moni Split %
        ]]
        
        log.info(
            f"Saving expense - Date: {today}, Amount: {amount} {currency} "
            f"(${usd_amount:.2f} USD), Description: {description}, User: {user}"
        )
        
        append_transactions("Expenses", values)
        
        split_note = f" Split: Marco {marco_share}% / Moni {moni_share}%." if (marco_share, moni_share) not in {(100, 0), (0, 100)} else ""
        msg = f"✅ Saved {category}: {currency} {amount:.2f} ({format_usd(usd_amount)}).{split_note}"
        log.info(f"Successfully saved expense: {msg}")
        st.success(msg)
    except ValueError as e:
        log.error(f"Currency conversion error: {e}")
        st.error(f"Currency conversion error: {str(e)}")
    except Exception as e:
        log.error(f"Failed to save expense: {e}", exc_info=True)
        st.error(f"Failed to save expense: {str(e)}")


def format_usd(amount: float) -> str:
    return f"${amount:.2f} USD"


# ---------- PUBLIC ENTRYPOINT ----------

def render() -> None:
    """
    Render Home screen with expense form.
    Only shows content if user is authenticated.
    """
    # Check authentication and setup sheets
    if not ensure_startup():
        return  # Stop rendering if not authenticated
    
    render_global_header()
    render_add_expense_form()
