from __future__ import annotations

import io
from datetime import datetime
from uuid import uuid4
import re
from difflib import SequenceMatcher

import pandas as pd
import streamlit as st

from bootstrap import ensure_startup, render_global_header
from services.auth_service import get_authenticated_username
from services.google_sheets import (
    IMPORTS_SHEET_NAME,
    TRANSACTION_HEADERS,
    append_transactions,
    get_import_profiles,
    get_transaction_rows,
    save_import_profile,
)
from utils.logging_utils import setup_logging

log = setup_logging("expense_tracker_imports")

st.set_page_config(layout="wide", initial_sidebar_state="expanded")


BRUBANK_CURRENCY_MAP = {
    "Pesos (ARS)": "ARS",
    "Dólar (USD)": "USD",
}
KNOWN_IMPORT_ACCOUNTS = [
    "Revolut",
    "Brubank",
    "Wise",
]


def _read_uploaded_file(uploaded_file) -> pd.DataFrame:
    suffix = uploaded_file.name.lower()
    file_bytes = uploaded_file.getvalue()

    if suffix.endswith(".csv"):
        return pd.read_csv(io.BytesIO(file_bytes))
    if suffix.endswith(".xlsx") or suffix.endswith(".xls"):
        return pd.read_excel(io.BytesIO(file_bytes))
    if suffix.endswith(".pdf"):
        return _read_pdf_statement(uploaded_file.name, file_bytes)
    raise ValueError("Unsupported file type. Please upload CSV, Excel, or a supported PDF statement.")


def _read_pdf_statement(filename: str, file_bytes: bytes) -> pd.DataFrame:
    if "brubank" in filename.lower():
        return _parse_brubank_pdf(file_bytes)
    raise ValueError(
        "This PDF bank/card layout is not supported yet. Share one sample for that institution and I can add its parser."
    )


def _parse_localized_amount(text: str) -> float:
    cleaned = (
        text.replace("$", "")
        .replace("U$S", "")
        .replace("US$", "")
        .replace("US ", "")
        .replace("U$ ", "")
        .replace(".", "")
        .replace(",", ".")
        .strip()
    )
    if cleaned in {"", "-"}:
        return 0.0
    return float(cleaned)


def _parse_brubank_pdf(file_bytes: bytes) -> pd.DataFrame:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(file_bytes))
    rows: list[dict[str, object]] = []

    for page in reader.pages:
        text = page.extract_text() or ""
        raw_lines = [line.strip() for line in text.splitlines() if line.strip()]
        current_currency = None

        for index, line in enumerate(raw_lines):
            if line == "Moneda" and index + 1 < len(raw_lines):
                current_currency = BRUBANK_CURRENCY_MAP.get(raw_lines[index + 1], current_currency)

            if line == "Saldo":
                data_index = index + 1
                while data_index + 5 < len(raw_lines):
                    date_text = raw_lines[data_index]
                    if not re.fullmatch(r"\d{2}-\d{2}-\d{2}", date_text):
                        break

                    ref_text = raw_lines[data_index + 1]
                    description_text = raw_lines[data_index + 2]
                    debit_text = raw_lines[data_index + 3]
                    credit_text = raw_lines[data_index + 4]
                    balance_text = raw_lines[data_index + 5]

                    debit_amount = _parse_localized_amount(debit_text) if debit_text != "-" else 0.0
                    credit_amount = _parse_localized_amount(credit_text) if credit_text != "-" else 0.0
                    signed_amount = credit_amount if credit_amount > 0 else -debit_amount

                    parsed_date = datetime.strptime(date_text, "%d-%m-%y").strftime("%Y-%m-%d")
                    rows.append({
                        "Date": parsed_date,
                        "Reference": ref_text,
                        "Description": description_text,
                        "Amount": round(signed_amount, 2),
                        "Currency": current_currency or "ARS",
                        "Statement Type": "Brubank Statement",
                        "Statement State": "COMPLETED",
                        "Balance": balance_text,
                    })
                    data_index += 6

    if not rows:
        raise ValueError("I couldn't extract transaction rows from this Brubank PDF.")

    return pd.DataFrame(rows)


def _parse_amount(value) -> float | None:
    if pd.isna(value):
        return None

    text = str(value).strip()
    if not text:
        return None

    cleaned = (
        text.replace("$", "")
        .replace("€", "")
        .replace("RD$", "")
        .replace("U$S", "")
        .replace("US$", "")
        .replace("US ", "")
        .replace("U$ ", "")
        .replace(",", "")
        .replace("(", "-")
        .replace(")", "")
        .strip()
    )
    try:
        return float(cleaned)
    except ValueError:
        return None


def _normalize_import_preview(
    source_df: pd.DataFrame,
    date_column: str,
    amount_column: str,
    description_column: str,
    currency_column: str | None,
    fallback_currency: str,
    external_id_column: str | None,
) -> pd.DataFrame:
    preview = pd.DataFrame()
    source_type = source_df["Type"].fillna("").astype(str).str.strip() if "Type" in source_df.columns else pd.Series([""] * len(source_df))
    source_state = source_df["State"].fillna("").astype(str).str.strip() if "State" in source_df.columns else pd.Series([""] * len(source_df))

    preview["Date"] = pd.to_datetime(source_df[date_column], errors="coerce")
    preview["Signed Amount"] = source_df[amount_column].apply(_parse_amount)
    preview["Description"] = source_df[description_column].fillna("").astype(str).str.strip()
    preview["Statement Type"] = source_type
    preview["Statement State"] = source_state
    if currency_column:
        preview["Currency"] = (
            source_df[currency_column].fillna(fallback_currency).astype(str).str.strip().str.upper()
        )
    else:
        preview["Currency"] = fallback_currency
    if external_id_column:
        preview["External ID"] = source_df[external_id_column].fillna("").astype(str).str.strip()
    else:
        preview["External ID"] = ""

    preview = preview.dropna(subset=["Date", "Signed Amount"])
    preview = preview[preview["Description"] != ""]
    preview["Signed Amount"] = preview["Signed Amount"].astype(float).round(2)
    preview["Amount"] = preview["Signed Amount"].abs()
    preview["Detected Type"] = preview["Signed Amount"].apply(lambda amount: "Income" if amount > 0 else "Expense")
    preview["Include"] = ~preview["Statement Type"].str.lower().eq("exchange")
    preview["Date"] = preview["Date"].dt.strftime("%Y-%m-%d")
    return preview.reset_index(drop=True)[[
        "Include",
        "Date",
        "Detected Type",
        "Amount",
        "Currency",
        "Description",
        "Statement Type",
        "Statement State",
        "External ID",
    ]]


def _load_existing_project_transactions() -> pd.DataFrame:
    from config.constants import PROJECTS

    frames: list[pd.DataFrame] = []
    for project_name in PROJECTS:
        values = get_transaction_rows(project_name)
        if not values:
            continue
        headers = values[0]
        rows = values[1:]
        padded_rows = [
            row[: len(headers)] + [''] * max(0, len(headers) - len(row))
            for row in rows
        ]
        project_df = pd.DataFrame(padded_rows, columns=headers)
        for column in TRANSACTION_HEADERS:
            if column not in project_df.columns:
                project_df[column] = ''
        project_df = project_df[TRANSACTION_HEADERS].copy()
        project_df["Project"] = project_name
        frames.append(project_df)

    if not frames:
        return pd.DataFrame(columns=TRANSACTION_HEADERS + ["Project"])
    return pd.concat(frames, ignore_index=True)


def _description_similarity(left: str, right: str) -> float:
    return SequenceMatcher(None, left.lower().strip(), right.lower().strip()).ratio()


def _build_duplicate_hint(
    import_date: str,
    source_amount: float,
    source_currency: str,
    description: str,
    existing_rows: pd.DataFrame,
) -> str:
    if existing_rows.empty:
        return ""

    imported_date = pd.to_datetime(import_date, errors="coerce")
    if pd.isna(imported_date) or source_amount == 0:
        return ""

    pool = existing_rows.copy()
    pool["Parsed Date"] = pd.to_datetime(pool["Date"], errors="coerce")
    pool["Numeric Amount"] = pd.to_numeric(pool["Currency Amount"], errors="coerce").fillna(
        pd.to_numeric(pool["Amount"], errors="coerce")
    )
    pool = pool[pool["Currency"].fillna("").astype(str).str.upper() == source_currency]
    pool = pool[pool["Numeric Amount"].round(2) == round(source_amount, 2)]
    pool = pool[(pool["Parsed Date"] - imported_date).abs().dt.days <= 3]
    if pool.empty:
        return ""

    pool["Similarity"] = pool["Description"].fillna("").astype(str).apply(
        lambda existing_description: _description_similarity(description, existing_description)
    )
    pool = pool[pool["Similarity"] >= 0.55].sort_values(["Similarity", "Parsed Date"], ascending=[False, True]).head(1)
    if pool.empty:
        return ""

    best_match = pool.iloc[0]
    return (
        f"dup:{best_match['Project']}|{best_match['Date']}|"
        f"{float(best_match['Numeric Amount']):.2f}|{str(best_match['Description']).strip()}|"
        f"{best_match['Similarity']:.2f}"
    )


def _parse_duplicate_hint(hint: str) -> dict[str, str] | None:
    if not isinstance(hint, str) or not hint.startswith("dup:"):
        return None

    parts = hint[4:].split("|", 4)
    if len(parts) != 5:
        return None

    project, match_date, amount, description, similarity = parts
    return {
        "Project": project,
        "Matched Date": match_date,
        "Matched Amount": amount,
        "Matched Description": description,
        "Similarity": similarity,
    }


def _find_matching_column(columns: list[str], keywords: list[str]) -> str | None:
    normalized_columns = {column: column.strip().lower() for column in columns}
    for keyword in keywords:
        for original, normalized in normalized_columns.items():
            if keyword in normalized:
                return original
    return None


def _get_saved_profile(account: str) -> dict[str, str] | None:
    if not account.strip():
        return None

    normalized_account = account.strip().lower()
    profiles = get_import_profiles()
    for profile in reversed(profiles):
        if profile.get("Account", "").strip().lower() == normalized_account:
            return profile
    return None


def _guess_mapping(columns: list[str], saved_profile: dict[str, str] | None) -> dict[str, str | None]:
    normalized_column_set = {column.strip().lower() for column in columns}
    if {
        "date",
        "description",
        "amount",
        "currency",
        "reference",
    }.issubset(normalized_column_set):
        return {
            "date_column": next(column for column in columns if column.strip().lower() == "date"),
            "amount_column": next(column for column in columns if column.strip().lower() == "amount"),
            "description_column": next(column for column in columns if column.strip().lower() == "description"),
            "currency_column": next(column for column in columns if column.strip().lower() == "currency"),
            "external_id_column": next(column for column in columns if column.strip().lower() == "reference"),
            "fallback_currency": "ARS",
        }

    if {
        "type",
        "started date",
        "description",
        "amount",
        "currency",
        "state",
    }.issubset(normalized_column_set):
        return {
            "date_column": next(column for column in columns if column.strip().lower() == "started date"),
            "amount_column": next(column for column in columns if column.strip().lower() == "amount"),
            "description_column": next(column for column in columns if column.strip().lower() == "description"),
            "currency_column": next(column for column in columns if column.strip().lower() == "currency"),
            "external_id_column": None,
            "fallback_currency": "USD",
        }

    if saved_profile:
        guessed = {
            "date_column": saved_profile.get("Date Column") or None,
            "amount_column": saved_profile.get("Amount Column") or None,
            "description_column": saved_profile.get("Description Column") or None,
            "currency_column": saved_profile.get("Currency Column") or None,
            "external_id_column": saved_profile.get("External ID Column") or None,
            "fallback_currency": saved_profile.get("Fallback Currency") or "USD",
        }
        if all(
            value in columns or value in {None, "", "None"} for key, value in guessed.items() if key.endswith("_column")
        ):
            guessed["currency_column"] = None if guessed["currency_column"] in {"", "None"} else guessed["currency_column"]
            guessed["external_id_column"] = None if guessed["external_id_column"] in {"", "None"} else guessed["external_id_column"]
            return guessed

    return {
        "date_column": _find_matching_column(columns, ["transaction date", "booking date", "date", "posted"]),
        "amount_column": _find_matching_column(columns, ["amount", "importe", "value"]),
        "description_column": _find_matching_column(columns, ["description", "details", "concept", "merchant", "narrative"]),
        "currency_column": _find_matching_column(columns, ["currency", "curr", "moneda"]),
        "external_id_column": _find_matching_column(columns, ["reference", "ref", "id", "transaction id"]),
        "fallback_currency": "USD",
    }


def _mapping_is_complete(mapping: dict[str, str | None]) -> bool:
    return bool(mapping.get("date_column") and mapping.get("amount_column") and mapping.get("description_column"))


def render() -> None:
    if not ensure_startup():
        return

    username = get_authenticated_username()
    if username != "marconigris":
        st.error("Imports are only available for marconigris.")
        return

    render_global_header()
    st.markdown("## Statement Imports")
    st.caption("Upload a bank or card statement, map the core columns, preview the rows, and append them as imported transactions.")

    uploaded_file = st.file_uploader(
        "Statement file",
        type=["csv", "xlsx", "xls", "pdf"],
        help="Upload one bank or card export at a time.",
    )

    if not uploaded_file:
        st.info("Upload a CSV or Excel file to begin.")
        return

    try:
        source_df = _read_uploaded_file(uploaded_file)
    except Exception as error:
        st.error(f"Could not read file: {error}")
        return

    if source_df.empty:
        st.warning("The uploaded file is empty.")
        return

    source_df.columns = [str(column).strip() for column in source_df.columns]
    column_options = list(source_df.columns)
    none_option = ["None"] + column_options

    account_options = KNOWN_IMPORT_ACCOUNTS + ["Add new account"]
    selected_account_option = st.selectbox(
        "Target account",
        account_options,
        help="Type to search existing accounts, or choose Add new account.",
    )
    if selected_account_option == "Add new account":
        imported_account = st.text_input("New account name", placeholder="e.g. BHD Debit, Amex DR")
    else:
        imported_account = selected_account_option
    saved_profile = _get_saved_profile(imported_account) if imported_account else None
    guessed_mapping = _guess_mapping(column_options, saved_profile)
    mapping_complete = _mapping_is_complete(guessed_mapping)

    if saved_profile and mapping_complete:
        st.success("Loaded saved mapping for this account.")
    elif mapping_complete:
        st.info("Detected the statement format automatically. Expand mapping only if something looks wrong.")
    else:
        st.warning("I couldn't fully detect this statement format. Please confirm the mapping below.")

    st.markdown("### Mapping")
    if "Type" in source_df.columns and "State" in source_df.columns:
        st.caption("Detected a statement with built-in transaction type and status columns. Exchange rows will be deselected by default.")

    with st.expander("Mapping details", expanded=not mapping_complete):
        map_col1, map_col2, map_col3 = st.columns(3)
        with map_col1:
            date_column = st.selectbox(
                "Date column",
                column_options,
                index=column_options.index(guessed_mapping["date_column"]) if guessed_mapping["date_column"] in column_options else 0,
            )
            amount_column = st.selectbox(
                "Amount column",
                column_options,
                index=column_options.index(guessed_mapping["amount_column"]) if guessed_mapping["amount_column"] in column_options else min(1, len(column_options) - 1),
            )
        with map_col2:
            description_column = st.selectbox(
                "Description column",
                column_options,
                index=column_options.index(guessed_mapping["description_column"]) if guessed_mapping["description_column"] in column_options else min(2, len(column_options) - 1),
            )
            currency_column_choice = st.selectbox(
                "Currency column",
                none_option,
                index=none_option.index(guessed_mapping["currency_column"]) if guessed_mapping["currency_column"] in none_option else 0,
            )
        with map_col3:
            fallback_currency = st.selectbox(
                "Statement currency",
                ["USD", "EUR", "DOP", "ARS", "ZAR"],
                index=["USD", "EUR", "DOP", "ARS", "ZAR"].index(str(guessed_mapping["fallback_currency"])) if str(guessed_mapping["fallback_currency"]) in {"USD", "EUR", "DOP", "ARS", "ZAR"} else 0,
            )
            external_id_choice = st.selectbox(
                "Reference column",
                none_option,
                index=none_option.index(guessed_mapping["external_id_column"]) if guessed_mapping["external_id_column"] in none_option else 0,
            )

    preview_df = _normalize_import_preview(
        source_df=source_df,
        date_column=date_column,
        amount_column=amount_column,
        description_column=description_column,
        currency_column=None if currency_column_choice == "None" else currency_column_choice,
        fallback_currency=fallback_currency,
        external_id_column=None if external_id_choice == "None" else external_id_choice,
    )

    if preview_df.empty:
        st.warning("No valid rows were found after parsing the selected columns.")
        return

    st.markdown("### Preview")
    edited_preview = st.data_editor(
        preview_df,
        width="stretch",
        height=420,
        hide_index=True,
        column_config={
            "Include": st.column_config.CheckboxColumn("Include", default=True),
            "Date": st.column_config.TextColumn("Date", disabled=True),
            "Detected Type": st.column_config.TextColumn("Detected Type", disabled=True),
            "Amount": st.column_config.NumberColumn("Amount", format="%.2f"),
            "Currency": st.column_config.TextColumn("Currency"),
            "Description": st.column_config.TextColumn("Description"),
            "Statement Type": st.column_config.TextColumn("Statement Type", disabled=True),
            "Statement State": st.column_config.TextColumn("Statement State", disabled=True),
            "External ID": st.column_config.TextColumn("External ID"),
        },
    )

    included_rows = edited_preview[edited_preview["Include"] == True].copy()
    st.caption(f"{len(included_rows)} of {len(edited_preview)} rows selected for import.")

    if st.button("Import statement rows", width="stretch", type="primary"):
        if not imported_account.strip():
            st.error("Please enter the bank or card account name.")
            return

        existing_project_rows = _load_existing_project_transactions()
        import_batch_id = f"batch_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid4().hex[:6]}"

        values = []
        duplicate_hints: list[str] = []
        for _, row in included_rows.iterrows():
            source_currency = str(row["Currency"]).strip().upper() or fallback_currency
            source_amount = abs(float(row["Amount"]))
            duplicate_hint = _build_duplicate_hint(
                import_date=str(row["Date"]).strip(),
                source_amount=source_amount,
                source_currency=source_currency,
                description=str(row["Description"]).strip(),
                existing_rows=existing_project_rows,
            )
            values.append([
                row["Date"],
                source_amount,
                row["Detected Type"],
                "Imported",
                f"{str(row['Description']).strip()} [{row['Statement Type']} / {row['Statement State']}]",
                source_amount,
                source_currency,
                username,
                "",
                "",
                imported_account.strip(),
                "unclassified",
                "import",
                import_batch_id,
                str(row["External ID"]).strip(),
                str(row["Statement State"]).strip().lower() or "pending",
                duplicate_hint,
            ])
            if duplicate_hint:
                duplicate_hints.append(duplicate_hint)

        try:
            append_transactions(IMPORTS_SHEET_NAME, values)
            save_import_profile(
                account=imported_account.strip(),
                date_column=date_column,
                amount_column=amount_column,
                description_column=description_column,
                currency_column=currency_column_choice,
                external_id_column=external_id_choice,
                fallback_currency=fallback_currency,
            )
            st.success(f"Imported {len(values)} rows into {IMPORTS_SHEET_NAME}. Batch id: {import_batch_id}")
            if duplicate_hints:
                duplicate_rows = []
                for hint in duplicate_hints:
                    parsed_hint = _parse_duplicate_hint(hint)
                    if parsed_hint:
                        duplicate_rows.append(parsed_hint)
                if duplicate_rows:
                    st.warning(
                        f"{len(duplicate_rows)} imported rows were flagged as possible duplicates. "
                        "They will already be highlighted in Classify Imports."
                    )
                    st.dataframe(pd.DataFrame(duplicate_rows), width="stretch", hide_index=True)
        except Exception as error:
            log.error("Failed to import statement rows: %s", error, exc_info=True)
            st.error(f"Import failed: {error}")


if __name__ == "__main__":
    render()
