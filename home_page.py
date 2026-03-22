from __future__ import annotations

import datetime as dt

import streamlit as st

from utils.logging_utils import setup_logging
from state import get_messages, add_message
from bootstrap import ensure_startup, render_global_header
from services.google_sheets import append_transactions

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
        
        submitted = st.form_submit_button("✅ Add Expense", use_container_width=True)
        
        if submitted:
            if amount > 0 and description:
                _save_expense(amount, description, currency)
            elif amount == 0:
                st.error("Please enter an amount greater than 0")
            else:
                st.error("Please enter a description")


def _save_expense(amount: float, description: str, currency: str) -> None:
    """Save expense to Google Sheets."""
    try:
        today = dt.date.today().isoformat()
        values = [[today, amount, currency, description]]
        
        log.info(f"Saving expense - Date: {today}, Amount: {amount}, Currency: {currency}, Description: {description}")
        
        append_transactions("Expenses", values)
        
        msg = f"✅ Expense saved: {currency} {amount} - {description}"
        log.info(f"Successfully saved expense: {msg}")
        add_message("assistant", msg)
        st.success(msg)
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
