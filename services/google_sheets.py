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
    Verificación suave: solo intenta crear el servicio.
    No hace fallar toda la app si hay problema con el ID; esos errores
    se manejarán cuando realmente leamos/escribamos.
    """
    try:
        _ = get_sheets_service()
        logger.info("Google Sheets service initialized correctly")
    except Exception as e:
        logger.exception("Error verifying Google Sheets service")
        # No relanzamos para que la app pueda seguir levantando


def get_sheet_url() -> str | None:
    """
    Devuelve la URL del Google Sheet principal si el ID está configurado.
    """
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
    spreadsheet_id = os.getenv(SPREADSHEET_ID_ENV_VAR)
    if not spreadsheet_id:
        raise ValueError(f"{SPREADSHEET_ID_ENV_VAR} environment variable not set")

    body = {"values": values}

    try:
        service.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body=body,
        ).execute()
    except Exception as e:
        logger.exception("Error appending transactions to Google Sheets")
        raise e
