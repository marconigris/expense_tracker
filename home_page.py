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

EXPENSE_AMOUNT_KEY = "expense_amount"
EXPENSE_DESCRIPTION_KEY = "expense_description"
EXPENSE_CATEGORY_KEY = "expense_category"
EXPENSE_CURRENCY_KEY = "expense_currency"
SHARED_EXPENSE_KEY = "shared_expense"
SPLIT_MARCO_AMOUNT_KEY = "split_marco_amount"
SPLIT_MONI_AMOUNT_KEY = "split_moni_amount"
LAST_SPLIT_EDITED_KEY = "last_split_edited"
EXPENSE_SUCCESS_MESSAGE_KEY = "expense_success_message"
RESET_EXPENSE_FORM_KEY = "reset_expense_form"


# ---------- UI HELPERS ----------

def _render_currency_selector(label_visibility: str = "visible") -> str:
    """Render the currency picker as native segmented buttons."""
    return st.segmented_control(
        "Currency",
        ["USD", "EUR", "DOP"],
        selection_mode="single",
        key="expense_currency",
        label_visibility=label_visibility,
    )


def _initialize_expense_state(username: str) -> None:
    st.session_state.setdefault(EXPENSE_AMOUNT_KEY, None)
    st.session_state.setdefault(EXPENSE_DESCRIPTION_KEY, "")
    st.session_state.setdefault(EXPENSE_CATEGORY_KEY, list(CATEGORIES["Expense"].keys())[0])
    st.session_state.setdefault(EXPENSE_CURRENCY_KEY, "USD")
    st.session_state.setdefault(SHARED_EXPENSE_KEY, False)
    st.session_state.setdefault(SPLIT_MARCO_AMOUNT_KEY, 0.0)
    st.session_state.setdefault(SPLIT_MONI_AMOUNT_KEY, 0.0)
    st.session_state.setdefault(LAST_SPLIT_EDITED_KEY, "")
    st.session_state.setdefault(EXPENSE_SUCCESS_MESSAGE_KEY, "")
    st.session_state.setdefault(RESET_EXPENSE_FORM_KEY, False)
    _set_default_split_amounts(username, preserve_manual=False)


def _set_default_split_amounts(username: str, preserve_manual: bool = True) -> None:
    amount = float(st.session_state.get(EXPENSE_AMOUNT_KEY) or 0.0)
    if preserve_manual and st.session_state.get(SHARED_EXPENSE_KEY):
        _sync_split_amounts(st.session_state.get(LAST_SPLIT_EDITED_KEY) or "marco")
        return

    normalized_user = username.strip().lower() if username else ""
    if st.session_state.get(SHARED_EXPENSE_KEY):
        st.session_state[SPLIT_MARCO_AMOUNT_KEY] = round(amount / 2, 2)
        st.session_state[SPLIT_MONI_AMOUNT_KEY] = round(amount - st.session_state[SPLIT_MARCO_AMOUNT_KEY], 2)
        st.session_state[LAST_SPLIT_EDITED_KEY] = "marco"
    elif normalized_user == "marconigris":
        st.session_state[SPLIT_MARCO_AMOUNT_KEY] = round(amount, 2)
        st.session_state[SPLIT_MONI_AMOUNT_KEY] = 0.0
        st.session_state[LAST_SPLIT_EDITED_KEY] = "marco"
    elif normalized_user == "monigila":
        st.session_state[SPLIT_MARCO_AMOUNT_KEY] = 0.0
        st.session_state[SPLIT_MONI_AMOUNT_KEY] = round(amount, 2)
        st.session_state[LAST_SPLIT_EDITED_KEY] = "moni"
    else:
        st.session_state[SPLIT_MARCO_AMOUNT_KEY] = 0.0
        st.session_state[SPLIT_MONI_AMOUNT_KEY] = 0.0
        st.session_state[LAST_SPLIT_EDITED_KEY] = ""


def _sync_split_amounts(edited_field: str) -> None:
    amount = float(st.session_state.get(EXPENSE_AMOUNT_KEY) or 0.0)
    marco_amount = float(st.session_state.get(SPLIT_MARCO_AMOUNT_KEY) or 0.0)
    moni_amount = float(st.session_state.get(SPLIT_MONI_AMOUNT_KEY) or 0.0)

    if edited_field == "marco":
        marco_amount = min(max(marco_amount, 0.0), amount)
        moni_amount = round(max(amount - marco_amount, 0.0), 2)
        marco_amount = round(amount - moni_amount, 2)
    else:
        moni_amount = min(max(moni_amount, 0.0), amount)
        marco_amount = round(max(amount - moni_amount, 0.0), 2)
        moni_amount = round(amount - marco_amount, 2)

    st.session_state[SPLIT_MARCO_AMOUNT_KEY] = marco_amount
    st.session_state[SPLIT_MONI_AMOUNT_KEY] = moni_amount
    st.session_state[LAST_SPLIT_EDITED_KEY] = edited_field


def _handle_total_amount_change(username: str) -> None:
    _set_default_split_amounts(username)


def _handle_marco_split_change() -> None:
    _sync_split_amounts("marco")


def _handle_moni_split_change() -> None:
    _sync_split_amounts("moni")


def _handle_shared_toggle(username: str) -> None:
    _set_default_split_amounts(username, preserve_manual=False)


def _get_split_percentages(username: str) -> tuple[int, int]:
    amount = float(st.session_state.get(EXPENSE_AMOUNT_KEY) or 0.0)
    if amount <= 0:
        return (0, 0)

    if not st.session_state.get(SHARED_EXPENSE_KEY):
        normalized_user = username.strip().lower() if username else ""
        if normalized_user == "marconigris":
            return (100, 0)
        if normalized_user == "monigila":
            return (0, 100)

    marco_amount = float(st.session_state.get(SPLIT_MARCO_AMOUNT_KEY) or 0.0)
    marco_share = round((marco_amount / amount) * 100)
    marco_share = min(max(marco_share, 0), 100)
    moni_share = 100 - marco_share
    return (marco_share, moni_share)


def _reset_expense_form(username: str) -> None:
    st.session_state[RESET_EXPENSE_FORM_KEY] = True


def _apply_pending_reset(username: str) -> None:
    if not st.session_state.get(RESET_EXPENSE_FORM_KEY):
        return

    st.session_state[EXPENSE_AMOUNT_KEY] = None
    st.session_state[EXPENSE_DESCRIPTION_KEY] = ""
    st.session_state[SHARED_EXPENSE_KEY] = False
    st.session_state[RESET_EXPENSE_FORM_KEY] = False
    _set_default_split_amounts(username, preserve_manual=False)


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
            div[data-testid="stSegmentedControl"] button {
                min-height: 2.75rem;
            }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def _render_expense_intro() -> None:
    return None


def _close_expense_card() -> None:
    return None


def render_add_expense_form() -> None:
    """Render the form to add a new expense."""
    _render_mobile_form_styles()
    _render_expense_intro()
    
    # Get username from authenticated session
    username = get_authenticated_username()
    expense_categories = CATEGORIES["Expense"]
    _initialize_expense_state(username)
    _apply_pending_reset(username)

    if st.session_state.get(EXPENSE_SUCCESS_MESSAGE_KEY):
        st.success(st.session_state[EXPENSE_SUCCESS_MESSAGE_KEY])
        st.session_state[EXPENSE_SUCCESS_MESSAGE_KEY] = ""
    
    col1, col2 = st.columns([0.95, 1.05], gap="small")
    
    with col1:
        st.caption("Amount")
        amount = st.number_input(
            "Amount",
            min_value=0.0,
            value=st.session_state[EXPENSE_AMOUNT_KEY],
            step=0.01,
            format="%.2f",
            placeholder="Enter amount",
            key=EXPENSE_AMOUNT_KEY,
            on_change=_handle_total_amount_change,
            args=(username,),
            label_visibility="collapsed",
        )

    with col2:
        st.caption("Currency")
        currency = _render_currency_selector(label_visibility="collapsed")

    st.selectbox(
        "Category",
        list(expense_categories.keys()),
        key=EXPENSE_CATEGORY_KEY,
    )

    description = st.text_input(
        "Description",
        placeholder="e.g., Groceries, Gas, Coffee",
        key=EXPENSE_DESCRIPTION_KEY,
    )

    with st.expander("Split details (optional)", expanded=False):
        st.checkbox(
            "Shared expense",
            key=SHARED_EXPENSE_KEY,
            on_change=_handle_shared_toggle,
            args=(username,),
        )
        if st.session_state[SHARED_EXPENSE_KEY]:
            split_col1, split_col2 = st.columns(2, gap="medium")
            with split_col1:
                st.number_input(
                    "Marco amount",
                    min_value=0.0,
                    step=0.01,
                    format="%.2f",
                    key=SPLIT_MARCO_AMOUNT_KEY,
                    on_change=_handle_marco_split_change,
                )
            with split_col2:
                st.number_input(
                    "Moni amount",
                    min_value=0.0,
                    step=0.01,
                    format="%.2f",
                    key=SPLIT_MONI_AMOUNT_KEY,
                    on_change=_handle_moni_split_change,
                )

    if st.button("✅ Add Expense", use_container_width=True):
        marco_share, moni_share = _get_split_percentages(username)

        if amount and amount > 0 and description and username:
            _save_expense(
                amount,
                description,
                currency,
                st.session_state[EXPENSE_CATEGORY_KEY],
                username,
                marco_share,
                moni_share,
            )
            _reset_expense_form(username)
            st.rerun()
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
        st.session_state[EXPENSE_SUCCESS_MESSAGE_KEY] = msg
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
