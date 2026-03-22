import logging
import json
import os
from typing import Any, List

from google.oauth2 import service_account
from googleapiclient.discovery import build
import streamlit as st
from config.constants import DEFAULT_PROJECT, PROJECTS


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
            padded_row[7],
            padded_row[8],
            padded_row[9],
        ])
    return migrated_rows


def _migrate_project_rows(existing_rows: list[list[str]]) -> dict[str, list[list[Any]]]:
    migrated_rows = {project_name: [] for project_name in PROJECTS}
    for row in existing_rows:
        padded_row = row + [''] * max(0, 11 - len(row))
        project_name = padded_row[7] or DEFAULT_PROJECT
        if project_name not in migrated_rows:
            project_name = DEFAULT_PROJECT
        migrated_rows[project_name].append([
            padded_row[0],
            padded_row[1],
            padded_row[2],
            padded_row[3],
            padded_row[4],
            padded_row[5],
            padded_row[6],
            padded_row[8],
            padded_row[9],
            padded_row[10],
        ])
    return migrated_rows


def _ensure_sheet(service: Any, spreadsheet_id: str, sheet_name: str, existing_sheets: set[str]) -> None:
    if sheet_name in existing_sheets:
        return

    logger.info(f"Creating {sheet_name} sheet...")
    body = {
        'requests': [{
            'addSheet': {
                'properties': {
                    'title': sheet_name
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


def _read_sheet_values(service: Any, spreadsheet_id: str, sheet_name: str, end_column: str = 'J') -> list[list[str]]:
    result = _execute_request(
        service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f'{sheet_name}!A1:{end_column}'
        )
    )
    return result.get('values', [])


def _write_sheet_header(service: Any, spreadsheet_id: str, sheet_name: str) -> None:
    _execute_request(
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f'{sheet_name}!A1:J1',
            valueInputOption='RAW',
            body={'values': [EXPENSE_HEADERS]},
        )
    )


def _write_project_rows(service: Any, spreadsheet_id: str, sheet_name: str, rows: list[list[Any]]) -> None:
    _execute_request(
        service.spreadsheets().values().clear(
            spreadsheetId=spreadsheet_id,
            range=f'{sheet_name}!A:J',
            body={},
        )
    )
    _write_sheet_header(service, spreadsheet_id, sheet_name)
    if rows:
        _execute_request(
            service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range=f'{sheet_name}!A2:J{len(rows) + 1}',
                valueInputOption='USER_ENTERED',
                body={'values': rows},
            )
        )


def _execute_request(request: Any, num_retries: int = 3) -> Any:
    """Execute a Google Sheets request with retries for transient network failures."""
    return request.execute(num_retries=num_retries)


def _is_missing_range_error(error: Exception) -> bool:
    return "Unable to parse range" in str(error)


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


def verify_sheets_setup() -> bool:
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
            return False
        
        # Get existing sheets
        sheet_metadata = _execute_request(
            service.spreadsheets().get(spreadsheetId=spreadsheet_id)
        )
        sheets = sheet_metadata.get('sheets', [])
        existing_sheets = {s.get("properties", {}).get("title") for s in sheets}
        
        for project_name in PROJECTS:
            _ensure_sheet(service, spreadsheet_id, project_name, existing_sheets)

        # Refresh metadata after potential sheet creation
        refreshed_metadata = _execute_request(
            service.spreadsheets().get(spreadsheetId=spreadsheet_id)
        )
        sheets = refreshed_metadata.get('sheets', [])
        existing_sheets = {s.get("properties", {}).get("title") for s in sheets}

        for project_name in PROJECTS:
            project_values = _read_sheet_values(service, spreadsheet_id, project_name)
            project_headers = project_values[0] if project_values else []
            if not project_headers or project_headers != EXPENSE_HEADERS:
                logger.info(f"Setting up {project_name} sheet headers...")
                _write_sheet_header(service, spreadsheet_id, project_name)

        if 'Expenses' in existing_sheets:
            legacy_values = _read_sheet_values(service, spreadsheet_id, 'Expenses', end_column='K')
            legacy_headers = legacy_values[0] if legacy_values else []
            migrated_by_project: dict[str, list[list[Any]]] | None = None

            if legacy_headers == OLD_EXPENSE_HEADERS:
                migrated_by_project = {project_name: [] for project_name in PROJECTS}
                migrated_by_project[DEFAULT_PROJECT] = _migrate_expense_rows(legacy_values[1:])
            elif legacy_headers == SPLIT_EXPENSE_HEADERS:
                migrated_by_project = {project_name: [] for project_name in PROJECTS}
                migrated_by_project[DEFAULT_PROJECT] = _migrate_split_rows(legacy_values[1:])
            elif legacy_headers == [
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
            ]:
                migrated_by_project = _migrate_project_rows(legacy_values[1:])

            if migrated_by_project is not None:
                for project_name, rows in migrated_by_project.items():
                    project_values = _read_sheet_values(service, spreadsheet_id, project_name)
                    if len(project_values) <= 1 and rows:
                        logger.info(f"Migrating legacy Expenses rows into {project_name} sheet...")
                        _write_project_rows(service, spreadsheet_id, project_name, rows)
        
        # Initialize ExchangeRates sheet
        initialize_exchange_rates_sheet(service, spreadsheet_id)
        
        logger.info("Google Sheets setup verified")
        return True
    except Exception as e:
        logger.exception("Error verifying Google Sheets service")
        return False


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
        range_name = f"{range_name}!A:J"  # Columns A-J for per-project expense schema

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
        if _is_missing_range_error(e):
            logger.warning(f"Missing sheet range detected for {range_name}. Re-verifying sheet setup and retrying once.")
            if verify_sheets_setup():
                result = _execute_request(
                    service.spreadsheets().values().append(
                        spreadsheetId=spreadsheet_id,
                        range=range_name,
                        valueInputOption="USER_ENTERED",
                        insertDataOption="INSERT_ROWS",
                        body=body,
                    )
                )
                logger.info(f"Successfully appended transactions after sheet setup retry: {result.get('updates', {})}")
                return
        logger.exception("Error appending transactions to Google Sheets")
        raise e
