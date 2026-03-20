import logging
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build
import os
import streamlit as st
from typing import List, Any

@st.cache_resource
def get_sheets_service():
    """Cache Google Sheets service configuration"""
    try:
        creds_json = os.getenv('GOOGLE_SHEETS_CREDENTIALS')
        if creds_json is None:
            raise ValueError("GOOGLE_SHEETS_CREDENTIALS environment variable not set")
        creds_dict = json.loads(creds_json)
        creds = service_account.Credentials.from_service_account_info(  # type: ignore
            creds_dict,
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        service: Any = build('sheets', 'v4', credentials=creds)
        return service
    except Exception as e:
        raise e
