from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st

from bootstrap import ensure_startup
from services.auth_service import get_authenticated_username
from services.project_summary import get_private_dashboard_dataframe


st.set_page_config(layout="wide", initial_sidebar_state="expanded")


def _currency_symbol(currency: str) -> str:
    return {
        "USD": "$",
        "EUR": "€",
        "DOP": "RD$",
        "ARS": "ARS$",
        "ZAR": "R",
    }.get(currency, f"{currency} ")


def _format_currency(amount: float, currency: str) -> str:
    return f"{_currency_symbol(currency)}{amount:,.2f}"


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


def render() -> None:
    if not ensure_startup():
        return

    if get_authenticated_username() != "marconigris":
        st.error("Private dashboard is only available for marconigris.")
        return

    st.markdown("## Private Dashboard")
    st.caption("A single view of personal cash plus imported bank and card rows you classified as private.")

    report_currency = st.selectbox("Report currency", ["USD", "EUR", "ARS", "DOP", "ZAR"], index=0)
    raw_df = get_private_dashboard_dataframe(report_currency)

    if raw_df.empty:
        st.info("No private transactions found yet.")
        return

    raw_df = raw_df.copy()
    raw_df["Date"] = pd.to_datetime(raw_df["Date"], errors="coerce")
    raw_df = raw_df.dropna(subset=["Date"])

    filter_col1, filter_col2, filter_col3 = st.columns(3)
    with filter_col1:
        account_options = ["All accounts"] + sorted(account for account in raw_df["Account"].dropna().astype(str).unique() if account)
        selected_account = st.selectbox("Account", account_options)
    with filter_col2:
        type_options = ["All", "Expense", "Income"]
        selected_type = st.selectbox("Type", type_options)
    with filter_col3:
        date_range = st.date_input(
            "Period",
            value=(raw_df["Date"].min().date(), raw_df["Date"].max().date()),
            min_value=raw_df["Date"].min().date(),
            max_value=raw_df["Date"].max().date(),
        )

    filtered_df = raw_df.copy()
    if selected_account != "All accounts":
        filtered_df = filtered_df[filtered_df["Account"] == selected_account]
    if selected_type != "All":
        filtered_df = filtered_df[filtered_df["Type"] == selected_type]
    if isinstance(date_range, tuple) and len(date_range) == 2:
        start_date, end_date = pd.to_datetime(date_range[0]), pd.to_datetime(date_range[1])
        filtered_df = filtered_df[filtered_df["Date"].between(start_date, end_date)]

    if filtered_df.empty:
        st.info("No private transactions matched the current filters.")
        return

    income_total = float(filtered_df.loc[filtered_df["Type"] == "Income", "Amount"].sum())
    expense_total = float(filtered_df.loc[filtered_df["Type"] == "Expense", "Amount"].sum())
    net_total = income_total - expense_total
    _render_metric_cards(report_currency, income_total, expense_total, net_total, len(filtered_df))

    monthly_df = filtered_df.copy()
    monthly_df["Month"] = monthly_df["Date"].dt.to_period("M").astype(str)
    monthly_summary = (
        monthly_df.groupby(["Month", "Type"], as_index=False)["Amount"]
        .sum()
        .sort_values("Month")
    )

    account_summary = (
        filtered_df.groupby("Account", as_index=False)["Amount"]
        .sum()
        .sort_values("Amount", ascending=False)
    )

    expense_categories = (
        filtered_df[filtered_df["Type"] == "Expense"]
        .groupby("Category", as_index=False)["Amount"]
        .sum()
        .sort_values("Amount", ascending=False)
        .head(8)
    )

    chart_col1, chart_col2 = st.columns(2)
    with chart_col1:
        st.markdown("### Monthly Flow")
        monthly_chart = px.bar(
            monthly_summary,
            x="Month",
            y="Amount",
            color="Type",
            barmode="group",
            color_discrete_map={"Income": "#16a34a", "Expense": "#dc2626"},
        )
        monthly_chart.update_layout(height=340, margin=dict(l=12, r=12, t=24, b=12))
        st.plotly_chart(monthly_chart, width="stretch")

    with chart_col2:
        st.markdown("### By Account")
        account_chart = px.bar(
            account_summary,
            x="Account",
            y="Amount",
            color="Amount",
            color_continuous_scale=["#dbeafe", "#1d4ed8"],
        )
        account_chart.update_layout(height=340, margin=dict(l=12, r=12, t=24, b=12), coloraxis_showscale=False)
        st.plotly_chart(account_chart, width="stretch")

    if not expense_categories.empty:
        st.markdown("### Top Expense Categories")
        category_chart = px.bar(
            expense_categories,
            x="Amount",
            y="Category",
            orientation="h",
            color="Amount",
            color_continuous_scale=["#fde68a", "#f59e0b"],
        )
        category_chart.update_layout(height=320, margin=dict(l=12, r=12, t=24, b=12), coloraxis_showscale=False, yaxis={"categoryorder": "total ascending"})
        st.plotly_chart(category_chart, width="stretch")

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
