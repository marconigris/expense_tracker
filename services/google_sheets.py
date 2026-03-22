import logging
import json
import os
from typing import Any, List

from google.oauth2 import service_account
from googleapiclient.discovery import build
import streamlit as st
from config.constants import DEFAULT_PROJECT


logger = logging.getLogger(__name__)

# Usamos el mismo nombre de variable que tu Home.py original
SPREADSHEET_ID_ENV_VAR = "GOOGLE_SHEET_ID"

OLD_EXPENSE_HEADERS = [
    'Date',
    'Amount',
    'Type',
    'Category',
    'Subcategory',
    'Description',
    'Currency Amount',
    'Currency',
    'User',
]

EXPENSE_HEADERS = [
    'Date',
    'Amount',
    'Type',
    'Category',
    'Description',
    'Currency Amount',
    'Currency',
    'Project',
    'User',
    'Marco Split %',
    'Moni Split %',
]

SPLIT_EXPENSE_HEADERS = [
    'Date',
    'Amount',
    'Type',
    'Category',
    'Description',
    'Currency Amount',
    'Currency',
    'User',
    'Marco Split %',
    'Moni Split %',
]


def _default_split_for_user(user: str) -> list[int | str]:
    normalized_user = user.strip().lower()
    if normalized_user == "marconigris":
        return [100, 0]
    if normalized_user == "monigila":
        return [0, 100]
    return ["", ""]


def _migrate_expense_rows(existing_rows: list[list[str]]) -> list[list[Any]]:
    migrated_rows: list[list[Any]] = []
    for row in existing_rows:
        padded_row = row + [''] * max(0, len(OLD_EXPENSE_HEADERS) - len(row))
        user = padded_row[8]
        marco_split, moni_split = _default_split_for_user(user)
        migrated_rows.append([
            padded_row[0],
            padded_row[1],
            padded_row[2],
            padded_row[3],
            padded_row[5],
            padded_row[6],
            padded_row[7],
            DEFAULT_PROJECT,
            user,
            marco_split,
            moni_split,
        ])
    return migrated_rows


def _migrate_split_rows(existing_rows: list[list[str]]) -> list[list[Any]]:
    migrated_rows: list[list[Any]] = []
    for row in existing_rows:
        padded_row = row + [''] * max(0, len(SPLIT_EXPENSE_HEADERS) - len(row))
        migrated_rows.append([
            padded_row[0],
            padded_row[1],
            padded_row[2],
            padded_row[3],
            padded_row[4],
            padded_row[5],
            padded_row[6],
            DEFAULT_PROJECT,
            padded_row[7],
            padded_row[8],
            padded_row[9],
        ])
    return migrated_rows


def _execute_request(request: Any, num_retries: int = 3) -> Any:
    """Execute a Google Sheets request with retries for transient network failures."""
    return request.execute(num_retries=num_retries)


@st.cache_resource
def get_sheets_service():
    """Cache Google Sheets service configuration."""
    try:
        # Try to get credentials from Streamlit secrets first, then fall back to environment variables
        creds_json = None
        
        try:
            creds_json = st.secrets.get("GOOGLE_SHEETS_CREDENTIALS")
        except FileNotFoundError:
            creds_json = os.getenv("GOOGLE_SHEETS_CREDENTIALS")
        
        if creds_json is None:
            raise ValueError("GOOGLE_SHEETS_CREDENTIALS not found in secrets or environment variables")

        # Handle both string and dict formats
        if isinstance(creds_json, str):
            creds_dict = json.loads(creds_json)
        else:
            creds_dict = creds_json
            
        creds = service_account.Credentials.from_service_account_info(  # type: ignore
            creds_dict,
            scopes=["https://www.googleapis.com/auth/spreadsheets"],
        )
        service: Any = build("sheets", "v4", credentials=creds)
        return service
    except Exception as e:
        logger.exception("Error creating Google Sheets service")
        raise e


def initialize_exchange_rates_sheet(service: Any, spreadsheet_id: str) -> None:
    """
    Create and initialize the ExchangeRates sheet with GOOGLEFINANCE formulas.
    This sheet will fetch live exchange rates from Google Finance.
    """
    try:
        # Get existing sheets
        sheet_metadata = _execute_request(
            service.spreadsheets().get(spreadsheetId=spreadsheet_id)
        )
        sheets = sheet_metadata.get('sheets', [])
        existing_sheets = {s.get("properties", {}).get("title") for s in sheets}
        
        # Create sheet if it doesn't exist
        if 'ExchangeRates' not in existing_sheets:
            logger.info("Creating ExchangeRates sheet...")
            body = {
                'requests': [{
                    'addSheet': {
                        'properties': {
                            'title': 'ExchangeRates'
                        }
                    }
                }]
            }
            _execute_request(
                service.spreadsheets().batchUpdate(
                    spreadsheetId=spreadsheet_id,
                    body=body
                )
            )
        
        # Setup headers and formulas
        headers = [['Currency', 'Rate to USD']]
        
        # GOOGLEFINANCE formulas for live exchange rates.
        # We store "currency units per 1 USD" because convert_to_usd()
        # divides the input amount by this rate.
        formulas = [
            ['USD', 1.0],
            ['EUR', '=GOOGLEFINANCE("CURRENCY:USDEUR")'],
            ['DOP', '=GOOGLEFINANCE("CURRENCY:USDDOP")'],
        ]
        
        # Write headers
        _execute_request(
            service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range='ExchangeRates!A1:B1',
                valueInputOption='RAW',
                body={'values': headers}
            )
        )
        
        # Write formulas
        _execute_request(
            service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range='ExchangeRates!A2:B4',
                valueInputOption='USER_ENTERED',
                body={'values': formulas}
            )
        )
        
        logger.info("ExchangeRates sheet initialized with GOOGLEFINANCE formulas")
        
    except Exception as e:
        logger.error(f"Error initializing ExchangeRates sheet: {e}")
        # Don't raise - this is not critical


def verify_sheets_setup() -> None:
    """
    Verify and initialize Google Sheets with correct headers.
    Creates or updates the Expenses sheet and initializes exchange rates.
    """
    try:
        service = get_sheets_service()
        spreadsheet_id = None
        try:
            spreadsheet_id = st.secrets.get(SPREADSHEET_ID_ENV_VAR)
        except FileNotFoundError:
            spreadsheet_id = os.getenv(SPREADSHEET_ID_ENV_VAR)
        
        if not spreadsheet_id:
            logger.error(f"{SPREADSHEET_ID_ENV_VAR} not found in secrets or environment")
            return
        
        # Get existing sheets
        sheet_metadata = _execute_request(
            service.spreadsheets().get(spreadsheetId=spreadsheet_id)
        )
        sheets = sheet_metadata.get('sheets', [])
        existing_sheets = {s.get("properties", {}).get("title") for s in sheets}
        
        # Check if Expenses sheet exists
        if 'Expenses' not in existing_sheets:
            logger.info("Creating Expenses sheet...")
            body = {
                'requests': [{
                    'addSheet': {
                        'properties': {
                            'title': 'Expenses'
                        }
                    }
                }]
            }
            _execute_request(
                service.spreadsheets().batchUpdate(
                    spreadsheetId=spreadsheet_id,
                    body=body
                )
            )
        
        # Set headers for full format (for dashboard compatibility)
        headers = [EXPENSE_HEADERS]
        result = _execute_request(
            service.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id,
                range='Expenses!A1:K'
            )
        )
        
        current_values = result.get('values', [])
        current_headers = current_values[0] if current_values else []
        
        if current_headers == OLD_EXPENSE_HEADERS:
            logger.info("Migrating Expenses sheet to split-aware schema...")
            migrated_rows = _migrate_expense_rows(current_values[1:])
            _execute_request(
                service.spreadsheets().values().clear(
                    spreadsheetId=spreadsheet_id,
                    range='Expenses!A:K',
                    body={},
                )
            )
            _execute_request(
                service.spreadsheets().values().update(
                    spreadsheetId=spreadsheet_id,
                    range='Expenses!A1:K1',
                    valueInputOption='RAW',
                    body={'values': headers},
                )
            )
            if migrated_rows:
                _execute_request(
                    service.spreadsheets().values().update(
                        spreadsheetId=spreadsheet_id,
                        range=f'Expenses!A2:K{len(migrated_rows) + 1}',
                        valueInputOption='USER_ENTERED',
                        body={'values': migrated_rows},
                    )
                )
        elif current_headers == SPLIT_EXPENSE_HEADERS:
            logger.info("Adding Project column to Expenses sheet...")
            migrated_rows = _migrate_split_rows(current_values[1:])
            _execute_request(
                service.spreadsheets().values().clear(
                    spreadsheetId=spreadsheet_id,
                    range='Expenses!A:K',
                    body={},
                )
            )
            _execute_request(
                service.spreadsheets().values().update(
                    spreadsheetId=spreadsheet_id,
                    range='Expenses!A1:K1',
                    valueInputOption='RAW',
                    body={'values': headers},
                )
            )
            if migrated_rows:
                _execute_request(
                    service.spreadsheets().values().update(
                        spreadsheetId=spreadsheet_id,
                        range=f'Expenses!A2:K{len(migrated_rows) + 1}',
                        valueInputOption='USER_ENTERED',
                        body={'values': migrated_rows},
                    )
                )
        elif not current_headers or current_headers != headers[0]:
            logger.info("Setting up Expenses sheet headers...")
            _execute_request(
                service.spreadsheets().values().update(
                    spreadsheetId=spreadsheet_id,
                    range='Expenses!A1:K1',
                    valueInputOption='RAW',
                    body={'values': headers}
                )
            )
        
        # Initialize ExchangeRates sheet
        initialize_exchange_rates_sheet(service, spreadsheet_id)
        
        logger.info("Google Sheets setup verified")
    except Exception as e:
        logger.exception("Error verifying Google Sheets service")
        # No relanzamos para que la app pueda seguir levantando


def get_sheet_url() -> str | None:
    """
    Devuelve la URL del Google Sheet principal si el ID está configurado.
    """
    try:
        spreadsheet_id = st.secrets.get(SPREADSHEET_ID_ENV_VAR)
    except FileNotFoundError:
        spreadsheet_id = os.getenv(SPREADSHEET_ID_ENV_VAR)
    
    if not spreadsheet_id:
        return None

    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"


def append_transactions(range_name: str, values: List[List[Any]]) -> None:
    """
    Agrega filas a la hoja en el rango indicado.
    Lista para usar cuando quieras guardar transacciones.
    """
    service = get_sheets_service()
    
    try:
        spreadsheet_id = st.secrets.get(SPREADSHEET_ID_ENV_VAR)
    except FileNotFoundError:
        spreadsheet_id = os.getenv(SPREADSHEET_ID_ENV_VAR)
    
    if not spreadsheet_id:
        raise ValueError(f"{SPREADSHEET_ID_ENV_VAR} not found in secrets or environment variables")

    body = {"values": values}
    
    # Ensure range_name specifies just the columns, not rows (let Google Sheets find next empty row)
    if "!" not in range_name:
        range_name = f"{range_name}!A:K"  # Columns A-K for project-aware expense schema

    try:
        logger.info(f"Appending transactions to range: {range_name}")
        result = _execute_request(
            service.spreadsheets().values().append(
                spreadsheetId=spreadsheet_id,
                range=range_name,
                valueInputOption="USER_ENTERED",
                insertDataOption="INSERT_ROWS",
                body=body,
            )
        )
        logger.info(f"Successfully appended transactions: {result.get('updates', {})}")
    except Exception as e:
        logger.exception("Error appending transactions to Google Sheets")
        raise e
