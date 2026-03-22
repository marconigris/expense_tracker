from __future__ import annotations

from typing import Any, Dict, List
import streamlit as st
from config.constants import DEFAULT_PROJECT


# ---------- KEYS ----------

MESSAGES_KEY = "messages"
CURRENT_TRANSACTION_KEY = "current_transaction"
SHEETS_VERIFIED_KEY = "sheets_verified"
CURRENT_PROJECT_KEY = "current_project"


# ---------- INIT ----------

def init_session_state() -> None:
    """Inicializa las claves que usamos en session_state."""
    if MESSAGES_KEY not in st.session_state:
        st.session_state[MESSAGES_KEY] = []  # type: ignore[assignment]

    if CURRENT_TRANSACTION_KEY not in st.session_state:
        st.session_state[CURRENT_TRANSACTION_KEY] = None

    if SHEETS_VERIFIED_KEY not in st.session_state:
        st.session_state[SHEETS_VERIFIED_KEY] = False

    if CURRENT_PROJECT_KEY not in st.session_state:
        st.session_state[CURRENT_PROJECT_KEY] = DEFAULT_PROJECT


# ---------- MESSAGES HELPERS ----------

def get_messages() -> List[Dict[str, str]]:
    return st.session_state.get(MESSAGES_KEY, [])


def add_message(role: str, content: str) -> None:
    messages = st.session_state.get(MESSAGES_KEY, [])
    messages.append({"role": role, "content": content})
    st.session_state[MESSAGES_KEY] = messages


def clear_messages() -> None:
    st.session_state[MESSAGES_KEY] = []


# ---------- TRANSACTION HELPERS ----------

def get_current_transaction() -> Dict[str, Any] | None:
    return st.session_state.get(CURRENT_TRANSACTION_KEY)


def set_current_transaction(tx: Dict[str, Any] | None) -> None:
    st.session_state[CURRENT_TRANSACTION_KEY] = tx


def clear_current_transaction() -> None:
    st.session_state[CURRENT_TRANSACTION_KEY] = None


# ---------- SHEETS FLAG ----------

def is_sheets_verified() -> bool:
    return bool(st.session_state.get(SHEETS_VERIFIED_KEY, False))


def set_sheets_verified(value: bool = True) -> None:
    st.session_state[SHEETS_VERIFIED_KEY] = value


def get_current_project() -> str:
    return st.session_state.get(CURRENT_PROJECT_KEY, DEFAULT_PROJECT)


def set_current_project(project: str) -> None:
    st.session_state[CURRENT_PROJECT_KEY] = project
