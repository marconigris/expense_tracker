from __future__ import annotations

import os

import pandas as pd
import streamlit as st

from config.constants import get_project_config
from config.exchange_rates import convert_currency
from services.google_sheets import (
    SPREADSHEET_ID_ENV_VAR,
    get_sheets_service,
    verify_sheets_setup,
)


TRANSACTION_COLUMNS = [
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
    'Account',
    'Scope',
    'Source',
    'Import Batch ID',
    'External ID',
    'Reconciled',
    'Match ID',
]


def _get_spreadsheet_id() -> str:
    try:
        spreadsheet_id = st.secrets.get(SPREADSHEET_ID_ENV_VAR)
    except FileNotFoundError:
        spreadsheet_id = os.getenv(SPREADSHEET_ID_ENV_VAR)

    if not spreadsheet_id:
        raise ValueError(f"{SPREADSHEET_ID_ENV_VAR} not found in secrets or environment variables")
    return spreadsheet_id


def _normalize_transactions_dataframe(values: list[list[str]]) -> pd.DataFrame:
    if not values:
        return pd.DataFrame(columns=TRANSACTION_COLUMNS)

    raw_headers = values[0]
    rows = values[1:]
    normalized_rows = [
        row[: len(raw_headers)] + [''] * max(0, len(raw_headers) - len(row))
        for row in rows
    ]
    df = pd.DataFrame(normalized_rows, columns=raw_headers)

    for column in TRANSACTION_COLUMNS:
        if column not in df.columns:
            df[column] = ''

    return df[TRANSACTION_COLUMNS]


def _normalize_project_amounts(df: pd.DataFrame, project_name: str) -> pd.DataFrame:
    if df.empty:
        return df

    project_currency = get_project_config(project_name)["default_currency"]
    normalized_df = df.copy()

    def _normalize_row(row: pd.Series) -> float:
        currency_amount = pd.to_numeric(row.get('Currency Amount'), errors='coerce')
        source_currency = str(row.get('Currency', '')).strip().upper()
        stored_amount = pd.to_numeric(row.get('Amount'), errors='coerce')

        if pd.notna(currency_amount) and source_currency:
            try:
                return round(convert_currency(float(currency_amount), source_currency, project_currency), 2)
            except Exception:
                pass

        return float(stored_amount) if pd.notna(stored_amount) else 0.0

    normalized_df['Amount'] = normalized_df.apply(_normalize_row, axis=1)
    normalized_df['Amount'] = pd.to_numeric(normalized_df['Amount'], errors='coerce').fillna(0.0)
    return normalized_df


def get_personal_account_summary(project_name: str) -> dict[str, float | str]:
    values = _get_project_sheet_values(project_name)
    if not values:
        return {
            "currency": get_project_config(project_name)["default_currency"],
            "income_total": 0.0,
            "expense_total": 0.0,
            "net_balance": 0.0,
        }

    df = _normalize_transactions_dataframe(values)
    df = _normalize_project_amounts(df, project_name)

    income_total = df[df['Type'] == 'Income']['Amount'].sum()
    expense_total = df[df['Type'] == 'Expense']['Amount'].sum()
    return {
        "currency": get_project_config(project_name)["default_currency"],
        "income_total": float(income_total),
        "expense_total": float(expense_total),
        "net_balance": float(income_total - expense_total),
    }


def _get_project_sheet_values(project_name: str) -> list[list[str]]:
    service = get_sheets_service()
    spreadsheet_id = _get_spreadsheet_id()

    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f'{project_name}!A1:Q'
        ).execute()
    except Exception as error:
        if "Unable to parse range" in str(error) and verify_sheets_setup():
            result = service.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id,
                range=f'{project_name}!A1:Q'
            ).execute()
        else:
            raise

    return result.get('values', [])


def get_shared_account_summary(project_name: str) -> dict[str, float | str]:
    values = _get_project_sheet_values(project_name)
    if not values:
        return {
            "currency": get_project_config(project_name)["default_currency"],
            "total_expense": 0.0,
            "marco_paid": 0.0,
            "moni_paid": 0.0,
            "settlement_message": "Marco and Moni are settled up",
        }

    df = _normalize_transactions_dataframe(values)
    df = _normalize_project_amounts(df, project_name)
    expense_df = df[df['Type'] == 'Expense'].copy()
    if expense_df.empty:
        return {
            "currency": get_project_config(project_name)["default_currency"],
            "total_expense": 0.0,
            "marco_paid": 0.0,
            "moni_paid": 0.0,
            "settlement_message": "Marco and Moni are settled up",
        }

    normalized_users = expense_df['User'].fillna('').str.strip().str.lower()
    marco_share = pd.to_numeric(expense_df['Marco Split %'], errors='coerce').fillna(0.0)
    moni_share = pd.to_numeric(expense_df['Moni Split %'], errors='coerce').fillna(0.0)

    no_split_data = (marco_share + moni_share) == 0
    marco_share = marco_share.where(~no_split_data, (normalized_users == 'marconigris').astype(float) * 100)
    moni_share = moni_share.where(~no_split_data, (normalized_users == 'monigila').astype(float) * 100)

    marco_paid = float((expense_df['Amount'] * (marco_share / 100)).sum())
    moni_paid = float((expense_df['Amount'] * (moni_share / 100)).sum())
    total_expense = float(expense_df['Amount'].sum())
    equal_share = total_expense / 2
    marco_net = marco_paid - equal_share
    moni_net = moni_paid - equal_share

    if abs(marco_net) < 0.01 and abs(moni_net) < 0.01:
        settlement_message = "Marco and Moni are settled up"
    elif marco_net > 0 and moni_net < 0:
        settlement_message = f"Moni owes Marco {abs(moni_net):,.2f}"
    elif moni_net > 0 and marco_net < 0:
        settlement_message = f"Marco owes Moni {abs(marco_net):,.2f}"
    else:
        settlement_message = "Split data needs review"

    return {
        "currency": get_project_config(project_name)["default_currency"],
        "total_expense": total_expense,
        "marco_paid": marco_paid,
        "moni_paid": moni_paid,
        "settlement_message": settlement_message,
    }
