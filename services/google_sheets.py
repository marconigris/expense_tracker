import logging
import json
import os
from typing import Any, List

from google.oauth2 import service_account
from googleapiclient.discovery import build
import streamlit as st


logger = logging.getLogger(__name__)

SPREADSHEET_ID_ENV_VAR = "GOOGLE_SHEETS_SPREADSHEET_ID"


@st.cache_resource
def get_sheets_service():
    """Cache Google Sheets service configuration"""
    try:
        creds_json = os.getenv("GOOGLE_SHEETS_CREDENTIALS")
        if creds_json is None:
            raise ValueError("GOOGLE_SHEETS_CREDENTIALS environment variable not set")

        creds_dict = json.loads(creds_json)
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
    Verifica que el servicio de Sheets y el ID de la hoja estén configurados.
    Lanza excepción si falta algo o no hay acceso.
    """
    service = get_sheets_service()

    spreadsheet_id = os.getenv(SPREADSHEET_ID_ENV_VAR)
    if not spreadsheet_id:
        raise ValueError(f"{SPREADSHEET_ID_ENV_VAR} environment variable not set")

    try:
        service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    except Exception as e:
        logger.exception("Error verifying Google Sheets setup")
        raise RuntimeError(f"Error verifying Google Sheets setup: {e}") from e


def get_sheet_url() -> str:
    """
    Devuelve la URL del Google Sheet principal.
    """
    spreadsheet_id = os.getenv(SPREADSHEET_ID_ENV_VAR)
    if not spreadsheet_id:
        raise ValueError(f"{SPREADSHEET_ID_ENV_VAR} environment variable not set")

    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"


def append_transactions(range_name: str, values: List[List[Any]]) -> None:

