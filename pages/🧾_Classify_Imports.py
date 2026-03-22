from __future__ import annotations

import pandas as pd
import streamlit as st

from bootstrap import ensure_startup, render_global_header
from config.constants import PROJECTS, is_private_flow_project
from config.exchange_rates import convert_currency
from services.auth_service import get_authenticated_username
from services.google_sheets import (
    IMPORTS_SHEET_NAME,
    TRANSACTION_HEADERS,
    get_transaction_rows,
    append_transactions,
    overwrite_transaction_rows,
)
from utils.logging_utils import setup_logging

log = setup_logging("expense_tracker_classify_imports")

st.set_page_config(layout="wide", initial_sidebar_state="expanded")


def _format_sheet_dates(series: pd.Series) -> pd.Series:
    numeric_values = pd.to_numeric(series, errors="coerce")
    serial_dates = pd.to_datetime(
        numeric_values,
        unit="D",
        origin="1899-12-30",
        errors="coerce",
    )
    text_candidates = series.where(numeric_values.isna())
    text_dates = pd.to_datetime(text_candidates, errors="coerce")
    parsed_dates = serial_dates.fillna(text_dates)
    return parsed_dates.dt.strftime("%Y-%m-%d").fillna(series.astype(str))


def _load_imports_df() -> pd.DataFrame:
    values = get_transaction_rows(IMPORTS_SHEET_NAME)
    if not values:
        return pd.DataFrame(columns=TRANSACTION_HEADERS)

    headers = values[0]
    rows = values[1:]
    padded_rows = [
        row[: len(headers)] + [''] * max(0, len(headers) - len(row))
        for row in rows
    ]
    df = pd.DataFrame(padded_rows, columns=headers)
    for column in TRANSACTION_HEADERS:
        if column not in df.columns:
            df[column] = ''
    df = df[TRANSACTION_HEADERS].copy()
    df.insert(0, "Sheet Row", range(2, len(df) + 2))
    return df


def _to_project_transaction(row: pd.Series, target_project: str, payer_username: str) -> list[object]:
    project_currency = PROJECTS[target_project]["default_currency"]
    source_currency = str(row["Currency"]).strip().upper() or project_currency
    source_amount = float(pd.to_numeric(row["Currency Amount"], errors="coerce") or pd.to_numeric(row["Amount"], errors="coerce") or 0.0)
    project_amount = round(convert_currency(source_amount, source_currency, project_currency), 2)
    if is_private_flow_project(target_project):
        marco_share, moni_share = (100, 0)
        scope = "private"
        transaction_user = "marconigris"
    else:
        marco_share, moni_share = (100, 0) if payer_username == "marconigris" else (0, 100)
        scope = "shared"
        transaction_user = payer_username

    return [
        row["Date"],
        project_amount,
        row["Type"],
        "Imported",
        str(row["Description"]).strip(),
        round(source_amount, 2),
        source_currency,
        transaction_user,
        marco_share,
        moni_share,
        row["Account"],
        scope,
        "import",
        row["Import Batch ID"],
        row["External ID"],
        "posted",
        f"import_row_{row['Sheet Row']}",
    ]


def _parse_duplicate_hint(hint: str) -> dict[str, object] | None:
    if not isinstance(hint, str) or not hint.startswith("dup:"):
        return None

    parts = hint[4:].split("|", 4)
    if len(parts) != 5:
        return None

    project, match_date, amount, description, similarity = parts
    try:
        similarity_label = f"{float(similarity):.0%}"
    except ValueError:
        similarity_label = similarity

    return {
        "Matched Project": project,
        "Matched Date": match_date,
        "Matched Amount": amount,
        "Matched Description": description,
        "Similarity": similarity_label,
    }


def _duplicate_candidates_from_hints(import_rows: pd.DataFrame) -> pd.DataFrame:
    candidates: list[dict[str, object]] = []

    for _, imported in import_rows.iterrows():
        parsed_hint = _parse_duplicate_hint(str(imported.get("Match ID", "")))
        if not parsed_hint:
            continue

        candidates.append({
            "Imported Row": int(imported["Sheet Row"]),
            "Imported Date": imported["Date"],
            "Imported Amount": round(float(pd.to_numeric(imported["Currency Amount"], errors="coerce") or pd.to_numeric(imported["Amount"], errors="coerce") or 0.0), 2),
            "Imported Currency": str(imported["Currency"]).strip().upper(),
            "Imported Description": str(imported["Description"]).strip(),
            **parsed_hint,
        })

    return pd.DataFrame(candidates)


def _duplicate_flag_label(hint: str) -> str:
    parsed_hint = _parse_duplicate_hint(hint)
    if not parsed_hint:
        return ""
    return f"Possible duplicate in {parsed_hint['Matched Project']}"


def _merge_editor_changes(source_df: pd.DataFrame, edited_df: pd.DataFrame) -> pd.DataFrame:
    merged_df = source_df.copy().reset_index(drop=True)
    merged_df["Description"] = edited_df["Description"].fillna("").astype(str).str.strip()
    merged_df["Currency Amount"] = pd.to_numeric(edited_df["Currency Amount"], errors="coerce").fillna(
        pd.to_numeric(merged_df["Currency Amount"], errors="coerce").fillna(
            pd.to_numeric(merged_df["Amount"], errors="coerce").fillna(0.0)
        )
    )
    return merged_df


def render() -> None:
    if not ensure_startup():
        return

    username = get_authenticated_username()
    if username != "marconigris":
        st.error("Import classification is only available for marconigris.")
        return

    render_global_header()
    st.markdown("## Classify Imports")
    st.caption("Review imported bank or card rows, then mark them as private, shared, transfers, or ignored.")

    df = _load_imports_df()
    if df.empty:
        st.info("No imported rows found yet.")
        return

    filter_col1, filter_col2, filter_col3, filter_col4 = st.columns(4)
    with filter_col1:
        account_options = ["All accounts"] + sorted(account for account in df["Account"].fillna("").astype(str).unique() if account)
        selected_account = st.selectbox("Account", account_options)
    with filter_col2:
        batch_options = ["All batches"] + sorted(batch for batch in df["Import Batch ID"].fillna("").astype(str).unique() if batch)
        selected_batch = st.selectbox("Batch", batch_options)
    with filter_col3:
        status_options = ["Unclassified", "All"]
        selected_status = st.selectbox("Rows", status_options)
    with filter_col4:
        type_options = ["All", "Expense", "Income"]
        selected_type = st.selectbox("Type", type_options)

    filtered_df = df.copy()
    if selected_account != "All accounts":
        filtered_df = filtered_df[filtered_df["Account"] == selected_account]
    if selected_batch != "All batches":
        filtered_df = filtered_df[filtered_df["Import Batch ID"] == selected_batch]
    if selected_status == "Unclassified":
        filtered_df = filtered_df[filtered_df["Scope"].fillna("").isin(["", "unclassified"])]
    if selected_type != "All":
        filtered_df = filtered_df[filtered_df["Type"].fillna("").astype(str).str.strip().str.lower() == selected_type.lower()]

    if filtered_df.empty:
        st.info("No rows matched the current filters.")
        return

    filtered_df = filtered_df.reset_index(drop=True)
    select_all = st.checkbox("Select all filtered rows")

    preview_df = filtered_df[[
        "Type",
        "Date",
        "Description",
        "Currency Amount",
        "Currency",
        "Account",
    ]].copy()
    preview_df["Date"] = _format_sheet_dates(preview_df["Date"])
    preview_df.insert(0, "Select", select_all)
    preview_df["Duplicate Flag"] = filtered_df["Match ID"].apply(_duplicate_flag_label)

    edited_df = st.data_editor(
        preview_df,
        width="stretch",
        height=440,
        hide_index=True,
        column_config={
            "Select": st.column_config.CheckboxColumn("Select", width="small"),
            "Type": st.column_config.TextColumn("Type", disabled=True, width="small"),
            "Date": st.column_config.DateColumn("Date", disabled=True, width="small", format="YYYY-MM-DD"),
            "Description": st.column_config.TextColumn("Description", width="medium"),
            "Currency Amount": st.column_config.NumberColumn("Currency Amount", format="%.2f", width="small"),
            "Currency": st.column_config.TextColumn("Currency", disabled=True, width="small"),
            "Account": st.column_config.TextColumn("Account", disabled=True, width="small"),
            "Duplicate Flag": st.column_config.TextColumn("Duplicate Flag", disabled=True),
        },
    )

    merged_filtered_df = _merge_editor_changes(filtered_df, edited_df)
    selected_rows = merged_filtered_df.loc[edited_df["Select"] == True, "Sheet Row"].tolist()
    st.caption(f"{len(selected_rows)} rows selected.")

    action_col1, action_col2, action_col3 = st.columns(3)
    with action_col1:
        action = st.segmented_control(
            "Classification",
            ["Private", "Project", "Transfer", "Ignore"],
            selection_mode="single",
            default="Private",
        )
    with action_col2:
        targetable_projects = list(PROJECTS.keys())
        target_project = st.selectbox("Target project", targetable_projects, disabled=action != "Project")
    with action_col3:
        paid_by = st.segmented_control(
            "Paid by",
            ["Marco", "Moni"],
            selection_mode="single",
            default="Marco",
            disabled=action != "Project" or is_private_flow_project(target_project),
        )

    if st.button("Apply classification", width="stretch", type="primary"):
        if not selected_rows:
            st.error("Select at least one row first.")
            return

        updated_df = df.copy()
        edited_selected_rows = merged_filtered_df.loc[edited_df["Select"] == True, [
            "Sheet Row",
            "Description",
            "Currency Amount",
        ]].copy()
        for _, edited_row in edited_selected_rows.iterrows():
            row_mask = updated_df["Sheet Row"] == edited_row["Sheet Row"]
            updated_df.loc[row_mask, "Description"] = edited_row["Description"]
            updated_df.loc[row_mask, "Currency Amount"] = edited_row["Currency Amount"]
        selected_mask = updated_df["Sheet Row"].isin(selected_rows)

        if action == "Project":
            payer_username = "marconigris" if paid_by == "Marco" else "monigila"
            rows_to_post = updated_df[selected_mask].apply(
                lambda row: _to_project_transaction(row, target_project, payer_username),
                axis=1,
            ).tolist()
            append_transactions(target_project, rows_to_post)
            updated_df.loc[selected_mask, "Scope"] = "private" if is_private_flow_project(target_project) else "shared"
            updated_df.loc[selected_mask, "User"] = "marconigris" if is_private_flow_project(target_project) else payer_username
            updated_df.loc[selected_mask, "Reconciled"] = "posted"
            updated_df.loc[selected_mask, "Match ID"] = target_project
        elif action == "Private":
            updated_df.loc[selected_mask, "Scope"] = "private"
            updated_df.loc[selected_mask, "Reconciled"] = "classified"
            updated_df.loc[selected_mask, "Match ID"] = "private"
        elif action == "Transfer":
            updated_df.loc[selected_mask, "Scope"] = "transfer"
            updated_df.loc[selected_mask, "Reconciled"] = "classified"
            updated_df.loc[selected_mask, "Match ID"] = "transfer"
        elif action == "Ignore":
            updated_df.loc[selected_mask, "Scope"] = "ignore"
            updated_df.loc[selected_mask, "Reconciled"] = "classified"
            updated_df.loc[selected_mask, "Match ID"] = "ignore"

        rows_to_write = updated_df[TRANSACTION_HEADERS].fillna("").values.tolist()
        overwrite_transaction_rows(IMPORTS_SHEET_NAME, rows_to_write)
        st.success(f"Applied `{action}` to {len(selected_rows)} rows.")
        st.rerun()


if __name__ == "__main__":
    render()
