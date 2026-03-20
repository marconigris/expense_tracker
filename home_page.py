from typing import Any
import streamlit as st

from utils.logging_utils import setup_logging
from services.google_sheets import get_sheets_service
from services.gemini_service import generate_text
from config.constants import CATEGORIES, TRANSACTION_TYPES
from state import (
    init_session_state,
    get_messages,
    add_message,
    clear_current_transaction,
    get_current_transaction,
    set_current_transaction,
)
from processing import process_user_input

log = setup_logging("expense_tracker_home")


# ---------- UI HELPERS ----------

def render_input_box() -> tuple[bool, str]:
    with st.form(key="input_form", clear_on_submit=True):
        col1, col2 = st.columns([8, 1])
        with col1:
            prompt = st.text_input(
                label="transaction_input",
                placeholder="What's the transaction?",
                label_visibility="collapsed",
            )
        with col2:
            submitted = st.form_submit_button("➤", use_container_width=True)
    return submitted, prompt


def render_confirmation_box(tx: dict[str, Any] | None) -> None:
    if not tx:
        return

    with st.expander("Confirm transaction", expanded=True):
        st.write(f"Date: {tx.get('date')}")
        st.write(f"Amount: {tx.get('amount')}")
        st.write(f"Type: {tx.get('type')}")
        st.write(f"Category: {tx.get('category')}")
        st.write(f"Subcategory: {tx.get('subcategory')}")
        st.write(f"Description: {tx.get('description')}")


def render_messages_log() -> None:
    st.subheader("Log")
    for message in get_messages():
        with st.chat_message(message["role"]):
            st.markdown(message["content"])


# ---------- CONTROLLER ----------

def handle_new_prompt(prompt: str) -> None:
    if not prompt:
        return

    # reset estado de la conversación para nueva transacción
    st.session_state.messages = []
    clear_current_transaction()

    log.debug(f"Received user input: {prompt}")
    add_message("user", prompt)

    extracted_info = process_user_input(prompt)
    set_current_transaction(extracted_info)

    # mensaje simple al usuario
    add_message("assistant", "Procesé la transacción, revisá la caja de confirmación 👇")


# ---------- PUBLIC ENTRYPOINT ----------

def render() -> None:
    """
    Renderiza la pantalla Home:
    - input
    - confirmación
    - mensajes
    - log
    """
    init_session_state()

    submitted, prompt = render_input_box()

    if submitted and prompt:
        handle_new_prompt(prompt)

    render_confirmation_box(get_current_transaction())
    render_messages_log()
