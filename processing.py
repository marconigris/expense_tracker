from __future__ import annotations

from typing import Any, Dict
import datetime as dt

from config.constants import CATEGORIES, TRANSACTION_TYPES
from services.gemini_service import generate_text
from utils.logging_utils import setup_logging

log = setup_logging("expense_tracker_processing")


def _normalize_amount(amount_str: str) -> float | None:
    try:
        value = amount_str.replace(",", ".").strip()
        return float(value)
    except Exception:
        return None


def _parse_date(date_str: str) -> str:
    """
    Intenta normalizar la fecha a formato ISO (YYYY-MM-DD).
    Si falla, devuelve hoy.
    """
    today = dt.date.today()

    if not date_str:
        return today.isoformat()

    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return dt.datetime.strptime(date_str, fmt).date().isoformat()
        except ValueError:
            continue

    log.warning(f"Could not parse date: {date_str}, usando hoy")
    return today.isoformat()


def _safe_category(cat: str) -> str:
    if not cat:
        return "Other"
    if cat in CATEGORIES:
        return cat
    return "Other"


def _safe_transaction_type(tx_type: str) -> str:
    if not tx_type:
        return "expense"
    if tx_type in TRANSACTION_TYPES:
        return tx_type
    return "expense"


def process_user_input(prompt: str) -> Dict[str, Any]:
    """
    Usa Gemini para extraer:
    - date
    - amount
    - type
    - category
    - subcategory
    - description
    Devuelve un dict listo para usar en la UI.
    """
    log.debug(f"Processing user input: {prompt}")

    full_prompt = f"""
You are an AI that extracts structured transaction data from natural language.

Return ONLY a JSON object with the following keys:
- date (string, e.g. "2024-01-31")
- amount (number)
- type (one of: {", ".join(TRANSACTION_TYPES)})
- category (one of: {", ".join(CATEGORIES)})
- subcategory (string)
- description (string, short human-readable summary)

If something is missing, make a reasonable guess.

User input: {prompt}
"""

    # generate_text de tu proyecto NO acepta system_instruction ni json_mode,
    # así que solo le pasamos el prompt grande.
    model_response = generate_text(full_prompt)

    if not isinstance(model_response, dict):
        log.warning(f"Model did not return a dict. Raw: {model_response}")
        model_response = {}

    raw_date = str(model_response.get("date", "") or "").strip()
    raw_amount = str(model_response.get("amount", "") or "").strip()
    raw_type = str(model_response.get("type", "") or "").strip()
    raw_category = str(model_response.get("category", "") or "").strip()
    subcategory = str(model_response.get("subcategory", "") or "").strip()
    description = str(model_response.get("description", "") or "").strip()

    date = _parse_date(raw_date)
    amount = _normalize_amount(raw_amount)
    tx_type = _safe_transaction_type(raw_type)
    category = _safe_category(raw_category)

    if amount is None:
        log.warning(f"Could not parse amount from: {raw_amount}, defaulting to 0")
        amount = 0.0

    extracted = {
        "date": date,
        "amount": amount,
        "type": tx_type,
        "category": category,
        "subcategory": subcategory or "General",
        "description": description or prompt,
    }

    log.debug(f"Extracted transaction: {extracted}")
    return extracted
