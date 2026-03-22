from __future__ import annotations

import datetime as dt

import streamlit as st

from utils.logging_utils import setup_logging
from state import get_messages, add_message, clear_messages
from bootstrap import ensure_startup, render_global_header
from services.google_sheets import append_transactions
from services.auth_service import get_authenticated_username
from config.exchange_rates import convert_to_usd

log = setup_logging("expense_tracker_home")


# ---------- UI HELPERS ----------

def _render_currency_selector() -> str:
    """Render a tap-friendly currency selector styled as square tiles."""
    st.markdown(
        """
        <style>
        div[data-testid="stRadio"] > div[role="radiogroup"] {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 0.75rem;
        }

        div[data-testid="stRadio"] > div[role="radiogroup"] > label {
            margin: 0;
            min-height: 92px;
            border: 1px solid rgba(49, 51, 63, 0.2);
            border-radius: 0.9rem;
            background: #f8fafc;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
        }

        div[data-testid="stRadio"] > div[role="radiogroup"] > label:hover {
            border-color: #2563eb;
            background: #eff6ff;
        }

        div[data-testid="stRadio"] > div[role="radiogroup"] > label:has(input:checked) {
            border-color: #2563eb;
            background: #dbeafe;
            box-shadow: inset 0 0 0 1px #2563eb;
        }

        div[data-testid="stRadio"] > div[role="radiogroup"] > label > div {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
        }

        div[data-testid="stRadio"] p {
            margin: 0;
            font-size: 1.1rem;
            font-weight: 700;
            letter-spacing: 0.04em;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )

    return st.radio(
        "Currency",
        ["USD", "EUR", "DOP"],
        horizontal=True,
        key="expense_currency",
    )


def render_add_expense_form() -> None:
    """Render the form to add a new expense."""
    st.subheader("Add Expense")
    
    # Get username from authenticated session
    username = get_authenticated_username()
    
    with st.form(key="add_expense_form", clear_on_submit=True):
        # Row 0: Amount (0,0) and Currency (0,1)
        col1, col2 = st.columns([1, 1], gap="medium")
        
        with col1:
            amount = st.number_input(
                "Amount",
                value=None,
                step=0.01,
                format="%.2f",
                placeholder="Enter amount"
            )
        
        with col2:
            currency = _render_currency_selector()
        
        # Row 1: Description (1,0) and (1,1) - spans both columns
        description = st.text_input(
            "Description",
            placeholder="e.g., Groceries, Gas, Coffee"
        )
        
        submitted = st.form_submit_button("✅ Add Expense", use_container_width=True)
        
        if submitted:
            if amount and amount > 0 and description and username:
                _save_expense(amount, description, currency, username)
            elif amount is None or amount == 0:
                st.error("Please enter an amount greater than 0")
            elif not description:
                st.error("Please enter a description")
            else:
                st.error("No user authenticated. Please log in.")


def _save_expense(amount: float, description: str, currency: str, user: str) -> None:
    """Save expense to Google Sheets with currency conversion."""
    try:
        today = dt.date.today().isoformat()
        
        # Convert the input amount to USD
        usd_amount = convert_to_usd(amount, currency)
        
        # Full row: Date, Amount (USD), Type, Category, Subcategory, Description, Currency Amount, Currency, User
        # Type, Category, Subcategory are defaults since simplified form doesn't include them
        values = [[
            today,                          # Date
            round(usd_amount, 2),          # Amount (converted to USD)
            "Expense",                     # Type (default)
            "Other",                       # Category (default)
            "Miscellaneous",              # Subcategory (default)
            description,                   # Description
            amount,                        # Currency Amount (original input)
            currency,                      # Currency
            user                           # User
        ]]
        
        log.info(
            f"Saving expense - Date: {today}, Amount: {amount} {currency} "
            f"(${usd_amount:.2f} USD), Description: {description}, User: {user}"
        )
        
        append_transactions("Expenses", values)
        
        msg = f"✅ Expense saved by {user}: {currency} {amount} (${usd_amount:.2f} USD) - {description}"
        log.info(f"Successfully saved expense: {msg}")
        add_message("assistant", msg)
        st.success(msg)
    except ValueError as e:
        log.error(f"Currency conversion error: {e}")
        st.error(f"Currency conversion error: {str(e)}")
    except Exception as e:
        log.error(f"Failed to save expense: {e}", exc_info=True)
        st.error(f"Failed to save expense: {str(e)}")


def render_messages_log() -> None:
    """Render the activity log."""
    col1, col2 = st.columns([1, 1])
    with col1:
        st.subheader("Activity Log")
    with col2:
        if st.button("🗑️ Clear", key="clear_log_btn", use_container_width=True):
            clear_messages()
            st.rerun()
    
    messages = get_messages()
    if not messages:
        st.info("No activity yet")
        return
    
    for message in messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])


# ---------- PUBLIC ENTRYPOINT ----------

def render() -> None:
    """
    Render Home screen with expense form and activity log.
    Only shows content if user is authenticated.
    """
    # Check authentication and setup sheets
    if not ensure_startup():
        return  # Stop rendering if not authenticated
    
    render_global_header()
    render_add_expense_form()
    render_messages_log()
