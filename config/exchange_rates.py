"""
Exchange rates using Google Sheets GOOGLEFINANCE formulas.
Rates are fetched from the ExchangeRates sheet in the Google Sheet.
"""

import streamlit as st
import logging
from typing import Dict

logger = logging.getLogger(__name__)

# Fallback rates (in case sheet is not available during startup)
FALLBACK_RATES = {
    "USD": 1.0,
    "USDT": 1.0,
    "EUR": 0.92,
    "DOP": 58.50,
    "ARS": 1080.00,
    "ZAR": 18.40,
}


@st.cache_data(ttl=3600)  # Cache for 1 hour
def get_exchange_rates() -> Dict[str, float]:
    """
    Fetch exchange rates from Google Sheets ExchangeRates sheet.
    Uses GOOGLEFINANCE formulas in the sheet for live rates.
    Falls back to hardcoded rates if sheet is unavailable.
    
    Returns:
        Dictionary of currency -> rate (relative to USD)
    """
    try:
        from services.google_sheets import get_sheets_service
        import os
        
        service = get_sheets_service()
        
        # Get spreadsheet ID from secrets
        spreadsheet_id = os.getenv("GOOGLE_SHEET_ID")
        if not spreadsheet_id:
            try:
                import streamlit as st_inner
                spreadsheet_id = st_inner.secrets.get("GOOGLE_SHEET_ID")
            except FileNotFoundError:
                spreadsheet_id = None
        
        if not spreadsheet_id:
            logger.warning("GOOGLE_SHEET_ID not found, using fallback rates")
            return FALLBACK_RATES
        
        # Fetch rates from ExchangeRates sheet
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range='ExchangeRates!A1:B10'
        ).execute()
        
        values = result.get('values', [])
        rates = dict(FALLBACK_RATES)
        
        # Parse the sheet (skip header row)
        for row in values[1:]:
            if len(row) >= 2:
                currency = row[0].strip().upper()
                try:
                    rate = float(row[1])
                    rates[currency] = rate
                except (ValueError, TypeError):
                    logger.warning(f"Could not parse rate for {currency}: {row[1]}")
                    continue
        
        if not rates:
            logger.warning("No rates found in ExchangeRates sheet, using fallback rates")
            return FALLBACK_RATES
        
        logger.info(f"Fetched exchange rates from Google Sheet: {rates}")
        return rates
        
    except Exception as e:
        logger.error(f"Error fetching exchange rates from sheet: {e}")
        logger.info("Using fallback rates")
        return FALLBACK_RATES


def convert_to_usd(amount: float, from_currency: str) -> float:
    """
    Convert an amount from a given currency to USD.
    
    Args:
        amount: The amount to convert
        from_currency: The currency code (e.g., "DOP", "EUR", "USD")
    
    Returns:
        The amount converted to USD
    """
    rates = get_exchange_rates()
    
    if from_currency not in rates:
        raise ValueError(f"Unknown currency: {from_currency}")
    
    rate = rates[from_currency]
    return amount / rate


def convert_currency(amount: float, from_currency: str, to_currency: str) -> float:
    """
    Convert an amount between supported currencies.
    """
    rates = get_exchange_rates()

    if from_currency not in rates:
        raise ValueError(f"Unknown currency: {from_currency}")
    if to_currency not in rates:
        raise ValueError(f"Unknown currency: {to_currency}")

    if from_currency == to_currency:
        return amount

    usd_amount = amount / rates[from_currency]
    return usd_amount * rates[to_currency]


def get_supported_currencies():
    """Get list of supported currencies."""
    rates = get_exchange_rates()
    return list(rates.keys())
