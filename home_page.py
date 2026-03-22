from __future__ import annotations

import datetime as dt

import streamlit as st

from utils.logging_utils import setup_logging
from state import get_messages, add_message
from bootstrap import ensure_startup, render_global_header
from services.google_sheets import append_transactions
from config.exchange_rates import convert_to_usd

log = setup_logging("expense_tracker_home")


# ---------- UI HELPERS ----------

def render_add_expense_form() -> None:
    """Render the form to add a new expense."""
    st.subheader("Add Expense")
    
    with st.form(key="add_expense_form", clear_on_submit=True):
        amount = st.number_input(
            "Amount",
            min_value=0.0,
            step=0.01,
            format="%.2f"
        )
        
        description = st.text_input(
            "Description",
            placeholder="e.g., Groceries, Gas, Coffee"
        )
        
        currency = st.radio(
            "Currency",
            ["USD", "EUR", "DOP"],
            horizontal=True
        )
        
        user = st.text_input(
            "Your Name",
            placeholder="e.g., Marco, Juan",
            key="expense_user"
        )
        
        submitted = st.form_submit_button("✅ Add Expense", use_container_width=True)
        
        if submitted:
            if amount > 0 and description and user:
                _save_expense(amount, description, currency, user)
            elif amount == 0:
                st.error("Please enter an amount greater than 0")
            elif not description:
                st.error("Please enter a description")
            else:
                st.error("Please enter your name")


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
    st.subheader("Activity Log")
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
    """
    ensure_startup()
    render_global_header()

    render_add_expense_form()
    render_messages_log()
