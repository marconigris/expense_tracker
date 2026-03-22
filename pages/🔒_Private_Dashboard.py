from __future__ import annotations

from datetime import datetime

import pandas as pd
import plotly.express as px
import streamlit as st

from bootstrap import ensure_startup
from config.constants import PROJECTS
from services.auth_service import get_authenticated_username
from services.project_summary import (
    get_project_full_dashboard_dataframe,
    get_personal_account_summary,
    get_project_dashboard_dataframe,
    get_private_dashboard_dataframe,
    get_shared_account_summary,
)
from config.exchange_rates import convert_currency


st.set_page_config(layout="wide", initial_sidebar_state="expanded")

PRIVATE_DASHBOARD_CACHE_KEY = "private_dashboard_cache"
PRIVATE_BUBBLES_CACHE_KEY = "private_dashboard_bubbles_cache"
PRIVATE_SELECTED_PROJECT_KEY = "private_dashboard_selected_project"
PRIVATE_DEFAULT_REPORT_CURRENCY = "USD"
PRIVATE_DASHBOARD_BUBBLE_ORDER = [
    "Cash USD",
    "Cash EUR",
    "USDT",
    "Coaching",
    "Cabarete",
    "Hymerlife",
]


def _currency_symbol(currency: str) -> str:
    return {
        "USD": "$",
        "USDT": "$",
        "EUR": "€",
        "DOP": "RD$",
        "ARS": "ARS$",
        "ZAR": "R",
    }.get(currency, f"{currency} ")


def _format_currency(amount: float, currency: str) -> str:
    return f"{_currency_symbol(currency)}{amount:,.2f}"


def _get_cached_private_dataframe(report_currency: str) -> pd.DataFrame:
    cached = st.session_state.get(PRIVATE_DASHBOARD_CACHE_KEY, {})
    cached_rows = cached.get(report_currency, [])
    if not cached_rows:
        return pd.DataFrame()
    return pd.DataFrame(cached_rows)


def _set_cached_private_dataframe(report_currency: str, df: pd.DataFrame) -> None:
    cached = st.session_state.get(PRIVATE_DASHBOARD_CACHE_KEY, {})
    cached[report_currency] = df.to_dict("records")
    st.session_state[PRIVATE_DASHBOARD_CACHE_KEY] = cached


def _get_cached_project_bubble(project_name: str) -> dict[str, str | float] | None:
    cached = st.session_state.get(PRIVATE_BUBBLES_CACHE_KEY, {})
    return cached.get(project_name)


def _set_cached_project_bubble(project_name: str, summary: dict[str, str | float]) -> None:
    cached = st.session_state.get(PRIVATE_BUBBLES_CACHE_KEY, {})
    cached[project_name] = summary
    st.session_state[PRIVATE_BUBBLES_CACHE_KEY] = cached


def _render_metric_cards(report_currency: str, income_total: float, expense_total: float, net_total: float, transaction_count: int) -> None:
    st.markdown(
        f"""
        <style>
        .private-metrics {{
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 0.85rem;
            margin: 0.4rem 0 1rem;
        }}

        .private-metric-card {{
            border-radius: 1.35rem;
            padding: 1rem 1.05rem;
            background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
            border: 1px solid rgba(15, 23, 42, 0.08);
            box-shadow: 0 16px 36px rgba(15, 23, 42, 0.08);
        }}

        .private-metric-card.primary {{
            background: linear-gradient(180deg, #101828 0%, #1f2937 100%);
            color: #f8fafc;
            border: none;
        }}

        .private-metric-label {{
            font-size: 0.76rem;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            opacity: 0.68;
            margin-bottom: 0.45rem;
        }}

        .private-metric-value {{
            font-size: 1.55rem;
            line-height: 1.05;
            font-weight: 800;
            letter-spacing: -0.04em;
        }}

        @media (max-width: 900px) {{
            .private-metrics {{
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }}
        }}
        </style>
        <div class="private-metrics">
            <div class="private-metric-card primary">
                <div class="private-metric-label">Net Balance</div>
                <div class="private-metric-value">{_format_currency(net_total, report_currency)}</div>
            </div>
            <div class="private-metric-card">
                <div class="private-metric-label">Income</div>
                <div class="private-metric-value">{_format_currency(income_total, report_currency)}</div>
            </div>
            <div class="private-metric-card">
                <div class="private-metric-label">Expenses</div>
                <div class="private-metric-value">{_format_currency(expense_total, report_currency)}</div>
            </div>
            <div class="private-metric-card">
                <div class="private-metric-label">Transactions</div>
                <div class="private-metric-value">{transaction_count}</div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def _convert_amount(amount: float, from_currency: str, to_currency: str) -> float:
    try:
        return float(convert_currency(float(amount), from_currency, to_currency))
    except Exception:
        return float(amount)


def _current_month_slice(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    month_start = pd.Timestamp(datetime.now().date()).replace(day=1)
    month_end = month_start + pd.offsets.MonthEnd(0)
    return df[df["Date"].between(month_start, month_end)].copy()


def _current_year_slice(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df

    today = pd.Timestamp(datetime.now().date())
    year_start = pd.Timestamp(year=today.year, month=1, day=1)
    year_end = pd.Timestamp(year=today.year, month=12, day=31)
    return df[df["Date"].between(year_start, year_end)].copy()


def _monthly_shared_summary(project_name: str, project_currency: str) -> tuple[float, float, float, str]:
    project_df = get_project_dashboard_dataframe(project_name, project_currency)
    project_df = _current_month_slice(project_df)
    if project_df.empty:
        return 0.0, 0.0, 0.0, "Marco and Moni are settled up"

    income_total = float(project_df.loc[project_df["Type"] == "Income", "Amount"].sum())
    expense_total = float(project_df.loc[project_df["Type"] == "Expense", "Amount"].sum())
    net_total = income_total - expense_total

    expense_df = project_df[project_df["Type"] == "Expense"].copy()
    if expense_df.empty:
        return net_total, income_total, expense_total, "Marco and Moni are settled up"

    normalized_users = expense_df["User"].fillna("").astype(str).str.strip().str.lower()
    marco_share = pd.to_numeric(expense_df["Marco Split %"], errors="coerce").fillna(0.0)
    moni_share = pd.to_numeric(expense_df["Moni Split %"], errors="coerce").fillna(0.0)
    no_split_data = (marco_share + moni_share) == 0
    marco_share = marco_share.where(~no_split_data, (normalized_users == "marconigris").astype(float) * 100)
    moni_share = moni_share.where(~no_split_data, (normalized_users == "monigila").astype(float) * 100)

    marco_paid = float((expense_df["Amount"] * (marco_share / 100)).sum())
    moni_paid = float((expense_df["Amount"] * (moni_share / 100)).sum())
    total_expense = float(expense_df["Amount"].sum())
    equal_share = total_expense / 2
    marco_net = marco_paid - equal_share
    moni_net = moni_paid - equal_share

    if abs(marco_net) < 0.01 and abs(moni_net) < 0.01:
        settlement_message = "Marco and Moni are settled up"
    elif marco_net > 0 and moni_net < 0:
        settlement_message = f"Moni owes Marco {_format_currency(abs(moni_net), project_currency)}"
    elif moni_net > 0 and marco_net < 0:
        settlement_message = f"Marco owes Moni {_format_currency(abs(marco_net), project_currency)}"
    else:
        settlement_message = "Split data needs review"

    return net_total, income_total, expense_total, settlement_message


def _monthly_private_summary(project_name: str, project_currency: str) -> tuple[float, float, float]:
    project_df = get_project_dashboard_dataframe(project_name, project_currency)
    project_df = _current_month_slice(project_df)
    if project_df.empty:
        full_df = get_project_full_dashboard_dataframe(project_name, project_currency)
        current_balance = float(full_df["Amount"].sum()) if not full_df.empty else 0.0
        return current_balance, 0.0, 0.0
    income_total = float(project_df.loc[project_df["Type"] == "Income", "Amount"].sum())
    expense_total = float(project_df.loc[project_df["Type"] == "Expense", "Amount"].sum())
    net_total = income_total - expense_total
    return net_total, income_total, expense_total


def _project_bubble_summary(project_name: str) -> dict[str, str | float | list[str]]:
    project_config = PROJECTS[project_name]
    project_currency = str(project_config["default_currency"])
    project_type = str(project_config["type"])
    try:
        if project_type == "shared":
            amount, _, _, _ = _monthly_shared_summary(project_name, project_currency)
            total_summary = get_shared_account_summary(project_name)
            meta = [str(total_summary["settlement_message"])]
        else:
            amount, income_total, expense_total = _monthly_private_summary(project_name, project_currency)
            meta = [
                f"Income {_format_currency(income_total, project_currency)}",
                f"Expenses {_format_currency(expense_total, project_currency)}",
            ]

        result = {
            "project": project_name,
            "value": _format_currency(amount, project_currency),
            "meta": meta,
        }
        _set_cached_project_bubble(project_name, result)
        return result
    except Exception:
        cached_summary = _get_cached_project_bubble(project_name)
        if cached_summary:
            if "meta" not in cached_summary:
                legacy_note = str(cached_summary.get("note", "Temporarily unavailable"))
                cached_summary["meta"] = [legacy_note]
            if project_type == "shared":
                cached_meta = [str(item) for item in cached_summary.get("meta", [])]
                settlement_only = [
                    item for item in cached_meta
                    if not item.startswith("Income ") and not item.startswith("Expenses ")
                ]
                cached_summary["meta"] = settlement_only or ["Marco and Moni are settled up"]
            elif len(cached_summary.get("meta", [])) > 2:
                cached_summary["meta"] = [str(item) for item in cached_summary["meta"][:2]]
            return cached_summary
        return {
            "project": project_name,
            "value": _format_currency(0.0, project_currency),
            "meta": ["Temporarily unavailable"],
        }


def _summary_meta_items(summary: dict[str, str | float | list[str]]) -> list[str]:
    meta_items = summary.get("meta")
    if isinstance(meta_items, list):
        return [str(item) for item in meta_items]

    legacy_note = summary.get("note")
    if legacy_note is not None:
        return [str(legacy_note)]

    return ["Temporarily unavailable"]


def _render_project_bubbles() -> None:
    ordered_projects = [project_name for project_name in PRIVATE_DASHBOARD_BUBBLE_ORDER if project_name in PROJECTS]
    bubble_summaries = [_project_bubble_summary(project_name) for project_name in ordered_projects]
    selected_project = st.session_state.get(PRIVATE_SELECTED_PROJECT_KEY, "All")
    cards_markup = [
        f'<div class="private-project-card {"private-project-card--active" if selected_project == "All" else ""}">'
        '<div class="private-project-card__label">All Activity</div>'
        '<div class="private-project-card__value">Annual Overview</div>'
        '<div class="private-project-card__meta"><span>Everything together</span></div>'
        "</div>"
    ]

    cards_markup.extend(
        f'<div class="private-project-card {"private-project-card--active" if selected_project == summary["project"] else ""}">'
        f'<div class="private-project-card__label">{summary["project"]}</div>'
        f'<div class="private-project-card__value">{summary["value"]}</div>'
        f'<div class="private-project-card__meta">{"".join(f"<span>{item}</span>" for item in _summary_meta_items(summary))}</div>'
        "</div>"
        for summary in bubble_summaries
    )

    bubble_markup = (
        """
        <style>
        .private-project-bubbles-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 0.7rem;
            margin: 0.15rem 0 0.9rem;
        }

        .private-project-card {
            border-radius: 1.5rem;
            padding: 0.85rem 0.95rem;
            background:
                radial-gradient(circle at top left, rgba(255,255,255,0.2), transparent 35%),
                linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%);
            color: #f8fafc;
            box-shadow: 0 22px 48px rgba(15, 23, 42, 0.22);
        }

        .private-project-card__label {
            font-size: 0.66rem;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            opacity: 0.72;
        }

        .private-project-card__value {
            margin-top: 0.18rem;
            font-size: 1.45rem;
            line-height: 1.05;
            font-weight: 780;
            letter-spacing: -0.03em;
        }

        .private-project-card__meta {
            display: flex;
            gap: 0.75rem;
            flex-wrap: wrap;
            margin-top: 0.55rem;
            font-size: 0.78rem;
            font-weight: 600;
            opacity: 0.88;
        }

        .private-project-card__meta span {
            white-space: nowrap;
        }

        .private-project-card--active {
            outline: 2px solid rgba(255,255,255,0.52);
            outline-offset: -2px;
        }

        @media (max-width: 640px) {
            .private-project-card {
                border-radius: 1.25rem;
                padding: 0.8rem 0.9rem;
            }

            .private-project-card__value {
                font-size: 1.25rem;
            }
        }
        </style>
        """
        + f'<div class="private-project-bubbles-grid">{"".join(cards_markup)}</div>'
    )

    render_html = getattr(st, "html", None)
    if callable(render_html):
        render_html(bubble_markup)
    else:
        st.markdown(bubble_markup, unsafe_allow_html=True)


def _load_private_dashboard_dataframe(report_currency: str) -> tuple[pd.DataFrame, bool]:
    try:
        raw_df = get_private_dashboard_dataframe(report_currency)
        _set_cached_private_dataframe(report_currency, raw_df)
        return raw_df, False
    except Exception:
        cached_df = _get_cached_private_dataframe(report_currency)
        if not cached_df.empty:
            return cached_df, True
        raise


def _load_selected_dashboard_dataframe(selected_project: str, report_currency: str) -> tuple[pd.DataFrame, bool]:
    if selected_project == "All":
        return _load_private_dashboard_dataframe(report_currency)

    cache_key = f"{report_currency}::{selected_project}"
    try:
        raw_df = get_project_dashboard_dataframe(selected_project, report_currency)
        _set_cached_private_dataframe(cache_key, raw_df)
        return raw_df, False
    except Exception:
        cached_df = _get_cached_private_dataframe(cache_key)
        if not cached_df.empty:
            return cached_df, True
        raise


def render() -> None:
    if not ensure_startup():
        return

    if get_authenticated_username() != "marconigris":
        st.error("Private dashboard is only available for marconigris.")
        return

    st.markdown("## Private Dashboard")
    st.caption("A single view of personal cash plus imported bank and card rows you classified as private.")

    _render_project_bubbles()
    report_currency = PRIVATE_DEFAULT_REPORT_CURRENCY
    selected_project = st.session_state.get(PRIVATE_SELECTED_PROJECT_KEY, "All")
    raw_df, using_cached_data = _load_selected_dashboard_dataframe(selected_project, report_currency)
    if using_cached_data:
        st.warning("Showing cached private dashboard data because Google Sheets is temporarily unavailable.")
    if selected_project != "All":
        st.caption(f"Currently viewing: {selected_project}")

    if raw_df.empty:
        st.info("No private transactions found yet.")
        return

    raw_df = raw_df.copy()
    raw_df["Date"] = pd.to_datetime(raw_df["Date"], errors="coerce")
    raw_df = raw_df.dropna(subset=["Date"])
    filtered_df = _current_year_slice(raw_df.copy())

    balance_only_mode = False
    current_balance = 0.0
    if selected_project != "All" and filtered_df.empty:
        full_df = get_project_full_dashboard_dataframe(selected_project, report_currency)
        if not full_df.empty:
            full_df = full_df.copy()
            full_df["Date"] = pd.to_datetime(full_df["Date"], errors="coerce")
            full_df = full_df.dropna(subset=["Date"])
            filtered_df = _current_year_slice(full_df.copy())
            current_balance = float(full_df["Amount"].sum())
            balance_only_mode = True

    if filtered_df.empty:
        st.info("No transactions found for the current year.")
        return

    income_total = float(filtered_df.loc[filtered_df["Type"] == "Income", "Amount"].sum()) if not balance_only_mode else 0.0
    expense_total = float(filtered_df.loc[filtered_df["Type"] == "Expense", "Amount"].sum()) if not balance_only_mode else 0.0
    net_total = income_total - expense_total if not balance_only_mode else current_balance
    _render_metric_cards(report_currency, income_total, expense_total, net_total, len(filtered_df))

    monthly_df = filtered_df.copy()
    monthly_df["Month"] = monthly_df["Date"].dt.strftime("%b")
    month_order = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    if balance_only_mode:
        monthly_summary = pd.DataFrame({
            "Month": month_order * 2,
            "Type": (["Income"] * len(month_order)) + (["Expense"] * len(month_order)),
            "Amount": [0.0] * (len(month_order) * 2),
        })
    else:
        monthly_summary = (
            monthly_df.groupby(["Month", "Type"], as_index=False)["Amount"]
            .sum()
        )
        monthly_summary["Month"] = pd.Categorical(monthly_summary["Month"], categories=month_order, ordered=True)
        monthly_summary = monthly_summary.sort_values("Month")

    st.markdown("### Annual Flow")
    monthly_chart = px.bar(
        monthly_summary,
        x="Month",
        y="Amount",
        color="Type",
        barmode="group",
        color_discrete_map={"Income": "#16a34a", "Expense": "#dc2626"},
    )
    monthly_chart.update_layout(height=360, margin=dict(l=12, r=12, t=24, b=12))
    st.plotly_chart(monthly_chart, width="stretch")

    st.markdown("### Recent Activity")
    recent_df = filtered_df.sort_values("Date", ascending=False).copy()
    recent_df["Date"] = recent_df["Date"].dt.strftime("%Y-%m-%d")
    recent_df["Reported Amount"] = recent_df["Amount"].apply(lambda amount: _format_currency(float(amount), report_currency))
    recent_df["Original Amount"] = recent_df.apply(
        lambda row: _format_currency(float(row["Currency Amount"]), str(row["Currency"]).strip().upper() or report_currency),
        axis=1,
    )
    st.dataframe(
        recent_df[[
            "Date",
            "Type",
            "Reported Amount",
            "Original Amount",
            "Currency",
            "Description",
            "Category",
            "Account",
            "Project",
            "Ledger Group",
        ]],
        width="stretch",
        hide_index=True,
    )


if __name__ == "__main__":
    render()
