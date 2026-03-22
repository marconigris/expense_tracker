import logging
import json
import os
from typing import Any, List

from google.oauth2 import service_account
from googleapiclient.discovery import build
import streamlit as st


logger = logging.getLogger(__name__)

# Usamos el mismo nombre de variable que tu Home.py original
SPREADSHEET_ID_ENV_VAR = "GOOGLE_SHEET_ID"


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


def verify_sheets_setup() -> None:
    """
    Verify and initialize Google Sheets with correct headers.
    Creates or updates the Expenses sheet for the simplified format.
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
        sheet_metadata = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
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
            service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body=body
            ).execute()
        
        # Set headers for simplified format
        headers = [['Date', 'Amount', 'Currency', 'Description']]
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range='Expenses!A1:D1'
        ).execute()
        
        current_headers = result.get('values', [])
        
        # Only update headers if they're missing or wrong
        if not current_headers or current_headers[0] != headers[0]:
            logger.info("Setting up Expenses sheet headers...")
            service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range='Expenses!A1:D1',
                valueInputOption='RAW',
                body={'values': headers}
            ).execute()
        
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
    
    # Ensure range_name is properly formatted as "SheetName!A2:D" for appending after headers
    if "!" not in range_name:
        range_name = f"{range_name}!A2:Z"

    try:
        logger.info(f"Appending transactions to range: {range_name}")
        result = service.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body=body,
        ).execute()
        logger.info(f"Successfully appended transactions: {result.get('updates', {})}")
    except Exception as e:
        logger.exception("Error appending transactions to Google Sheets")
        raise e
