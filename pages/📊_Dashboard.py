import streamlit as st
import pandas as pd
import plotly.express as px
from datetime import datetime, timedelta
import sys
import json
import os
from google.oauth2 import service_account
from googleapiclient.discovery import build # type: ignore
from dotenv import load_dotenv
from utils.logging_utils import setup_logging
from bootstrap import ensure_startup, render_global_header, render_top_view_navigation, render_project_balance_banner
from state import get_current_project
from services.google_sheets import verify_sheets_setup
from config.constants import PROJECTS, is_private_flow_project
from config.exchange_rates import convert_currency

log = setup_logging("expense_tracker_analytics")

st.set_page_config(layout='wide', initial_sidebar_state="expanded")


def get_project_currency(project_name: str | None = None) -> str:
    active_project = project_name or get_current_project()
    return PROJECTS.get(active_project, PROJECTS["Cabarete"])["default_currency"]


def get_currency_symbol(currency: str) -> str:
    return {
        "USD": "$",
        "USDT": "$",
        "EUR": "€",
        "DOP": "RD$",
        "ARS": "ARS$",
        "ZAR": "R",
    }.get(currency, f"{currency} ")


def format_currency(amount: float, currency: str | None = None) -> str:
    active_currency = currency or get_project_currency()
    return f"{get_currency_symbol(active_currency)}{amount:,.2f}"


USER_DISPLAY_NAMES = {
    "marconigris": "Marco",
    "monigila": "Moni",
}

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
TRANSACTION_CACHE_KEY = "dashboard_transactions_cache"


def format_balance(amount: float) -> str:
    if abs(amount) < 0.01:
        return format_currency(0.0)
    if amount > 0:
        return f"+{format_currency(amount)}"
    return f"-{format_currency(abs(amount))}"


def calculate_payment_summary(expense_df: pd.DataFrame) -> dict[str, dict[str, float] | str]:
    normalized_users = expense_df['User'].fillna('').str.strip().str.lower()
    marco_share = pd.to_numeric(expense_df['Marco Split %'], errors='coerce').fillna(0.0)
    moni_share = pd.to_numeric(expense_df['Moni Split %'], errors='coerce').fillna(0.0)

    no_split_data = (marco_share + moni_share) == 0
    marco_share = marco_share.where(~no_split_data, (normalized_users == 'marconigris').astype(float) * 100)
    moni_share = moni_share.where(~no_split_data, (normalized_users == 'monigila').astype(float) * 100)

    marco_paid = (expense_df['Amount'] * (marco_share / 100)).sum()
    moni_paid = (expense_df['Amount'] * (moni_share / 100)).sum()
    equal_share = expense_df['Amount'].sum() / 2

    net_balances = {
        'Marco': marco_paid - equal_share,
        'Moni': moni_paid - equal_share,
    }

    if abs(net_balances['Marco']) < 0.01 and abs(net_balances['Moni']) < 0.01:
        settlement_message = "Marco and Moni are settled up"
    elif net_balances['Marco'] > 0 and net_balances['Moni'] < 0:
        settlement_message = f"Moni owes Marco {format_currency(abs(net_balances['Moni']))}"
    elif net_balances['Moni'] > 0 and net_balances['Marco'] < 0:
        settlement_message = f"Marco owes Moni {format_currency(abs(net_balances['Marco']))}"
    else:
        settlement_message = "Split data needs review"

    return {
        'paid_totals': {
            'Marco': marco_paid,
            'Moni': moni_paid,
        },
        'net_balances': net_balances,
        'settlement_message': settlement_message,
    }


def calculate_personal_summary(df: pd.DataFrame) -> dict[str, float]:
    income_total = df[df['Type'] == 'Income']['Amount'].sum()
    expense_total = df[df['Type'] == 'Expense']['Amount'].sum()
    net_balance = income_total - expense_total
    return {
        'income_total': income_total,
        'expense_total': expense_total,
        'net_balance': net_balance,
    }


def normalize_transactions_dataframe(values: list[list[str]]) -> pd.DataFrame:
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


def normalize_project_amounts(df: pd.DataFrame, project_name: str) -> pd.DataFrame:
    if df.empty:
        return df

    df = df.copy()
    project_currency = get_project_currency(project_name)

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

    df['Amount'] = df.apply(_normalize_row, axis=1)
    return df


def _get_cached_transactions(project_name: str) -> pd.DataFrame:
    cached = st.session_state.get(TRANSACTION_CACHE_KEY, {})
    cached_rows = cached.get(project_name, [])
    if not cached_rows:
        return pd.DataFrame(columns=TRANSACTION_COLUMNS)
    return pd.DataFrame(cached_rows, columns=TRANSACTION_COLUMNS)


def _set_cached_transactions(project_name: str, df: pd.DataFrame) -> None:
    cached = st.session_state.get(TRANSACTION_CACHE_KEY, {})
    cached[project_name] = df[TRANSACTION_COLUMNS].fillna("").to_dict("records")
    st.session_state[TRANSACTION_CACHE_KEY] = cached


def parse_sheet_dates(series: pd.Series) -> pd.Series:
    """Parse Google Sheets serial dates and regular date strings."""
    if pd.api.types.is_datetime64_any_dtype(series):
        return pd.to_datetime(series, errors='coerce')

    numeric_values = pd.to_numeric(series, errors='coerce')
    serial_dates = pd.to_datetime(
        numeric_values,
        unit='D',
        origin='1899-12-30',
        errors='coerce',
    )
    text_candidates = series.where(numeric_values.isna())
    text_dates = pd.to_datetime(text_candidates, errors='coerce')
    return serial_dates.fillna(text_dates)


def render_overview_cards(user_paid_totals: dict[str, float], total_expense: float, settlement_message: str) -> None:
    st.markdown(
        """
        <style>
        .overview-stack {
            display: grid;
            gap: 0.85rem;
            margin: 0.5rem 0 1rem;
        }

        .overview-pair {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 0.85rem;
        }

        .overview-card {
            border-radius: 1.4rem;
            padding: 1rem 1rem 1.05rem;
            background: linear-gradient(180deg, #ffffff 0%, #f4f6fb 100%);
            border: 1px solid rgba(15, 23, 42, 0.08);
            box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
        }

        .overview-card.primary {
            background: linear-gradient(180deg, #101828 0%, #1f2937 100%);
            color: #f8fafc;
            border: none;
        }

        .overview-card.accent {
            background: linear-gradient(180deg, #eef6ff 0%, #dbeafe 100%);
            border: 1px solid rgba(37, 99, 235, 0.12);
        }

        .overview-label {
            font-size: 0.78rem;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            opacity: 0.68;
            margin-bottom: 0.45rem;
        }

        .overview-value {
            font-size: 1.7rem;
            line-height: 1.05;
            font-weight: 800;
            letter-spacing: -0.04em;
        }

        .overview-note {
            font-size: 1rem;
            line-height: 1.35;
            font-weight: 600;
        }

        @media (max-width: 640px) {
            .overview-card {
                border-radius: 1.2rem;
                padding: 0.95rem;
            }

            .overview-value {
                font-size: 1.45rem;
            }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )

    st.markdown(
        f"""
        <div class="overview-stack">
            <div class="overview-pair">
                <div class="overview-card">
                    <div class="overview-label">Marco</div>
                    <div class="overview-value">{format_currency(user_paid_totals["Marco"])}</div>
                </div>
                <div class="overview-card">
                    <div class="overview-label">Moni</div>
                    <div class="overview-value">{format_currency(user_paid_totals["Moni"])}</div>
                </div>
            </div>
            <div class="overview-card primary">
                <div class="overview-label">Total Expenses</div>
                <div class="overview-value">{format_currency(total_expense)}</div>
            </div>
            <div class="overview-card accent">
                <div class="overview-label">Settlement</div>
                <div class="overview-note">{settlement_message}</div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_personal_overview_cards(income_total: float, expense_total: float, net_balance: float) -> None:
    st.markdown(
        f"""
        <div class="overview-stack">
            <div class="overview-pair">
                <div class="overview-card">
                    <div class="overview-label">Income</div>
                    <div class="overview-value">{format_currency(income_total)}</div>
                </div>
                <div class="overview-card">
                    <div class="overview-label">Expenses</div>
                    <div class="overview-value">{format_currency(expense_total)}</div>
                </div>
            </div>
            <div class="overview-card primary">
                <div class="overview-label">Net Balance</div>
                <div class="overview-value">{format_balance(net_balance)}</div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


# Load environment variables
load_dotenv()

@st.cache_resource
def get_google_sheets_service():
    """Cache Google Sheets credentials and service"""
    try:
        creds_json = os.getenv('GOOGLE_SHEETS_CREDENTIALS')
        if not creds_json:
            try:
                creds_json = st.secrets.get("GOOGLE_SHEETS_CREDENTIALS")
            except FileNotFoundError:
                creds_json = None

        creds = service_account.Credentials.from_service_account_info(
            json.loads(creds_json),
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        service = build('sheets', 'v4', credentials=creds)
        return service
    except Exception as e:
        log.error(f"❌ Failed to connect to Google Sheets: {str(e)}")
        raise

# Initialize service and sheet ID
try:
    service = get_google_sheets_service()
    SHEET_ID = os.getenv('GOOGLE_SHEET_ID')
    if not SHEET_ID:
        try:
            SHEET_ID = st.secrets.get('GOOGLE_SHEET_ID')
        except FileNotFoundError:
            SHEET_ID = None
except Exception:
    st.error("Failed to connect to Google Sheets. Please check your credentials.")
    sys.exit(1)

def get_transactions_data(project_name: str):
    try:
        log.debug("Fetching transactions data from Google Sheets")
        result = service.spreadsheets().values().get(
            spreadsheetId=SHEET_ID,
            range=f'{project_name}!A1:Q'
        ).execute()
        
        values = result.get('values', [])
        if not values:
            log.warning("No transaction data found in sheet")
            return pd.DataFrame(columns=TRANSACTION_COLUMNS)
        log.info(f" Retrieved {len(values)-1} transaction records")
        df = normalize_transactions_dataframe(values)
        df = normalize_project_amounts(df, project_name)
        _set_cached_transactions(project_name, df)
        return df
    except Exception as e:
        if "Unable to parse range" in str(e):
            log.warning(f"Missing range for project {project_name}. Re-verifying sheet setup and retrying once.")
            if verify_sheets_setup():
                result = service.spreadsheets().values().get(
                    spreadsheetId=SHEET_ID,
                    range=f'{project_name}!A1:Q'
                ).execute()
                values = result.get('values', [])
                if not values:
                    return pd.DataFrame(columns=TRANSACTION_COLUMNS)
                df = normalize_transactions_dataframe(values)
                df = normalize_project_amounts(df, project_name)
                _set_cached_transactions(project_name, df)
                return df
        error_text = str(e).lower()
        if (
            isinstance(e, TimeoutError)
            or "timed out" in error_text
            or "ssl" in error_text
            or "record layer failure" in error_text
        ):
            cached_df = _get_cached_transactions(project_name)
            if not cached_df.empty:
                log.warning(
                    "Google Sheets read failed for project %s. Using cached dashboard data.",
                    project_name,
                )
                st.warning("Balances are temporarily using cached data because Google Sheets could not be reached.")
                return cached_df
        log.error(f"❌ Failed to fetch transactions data: {str(e)}")
        raise

@st.cache_data(ttl=300)
def get_pending_transactions() -> pd.DataFrame:
    """
    Fetch pending transactions from Google Sheet.
    Only returns transactions with status 'Pending'.
    """
    try:
        log.debug("Fetching pending transactions data")
        result = service.spreadsheets().values().get(
            spreadsheetId=SHEET_ID,
            range='Pending!A1:G'  # Include status column
        ).execute()
        
        values = result.get('values', [])
        if not values:
            log.warning("No data found in Pending sheet")
            return pd.DataFrame(columns=['Date', 'Amount', 'Type', 'Category', 'Description', 'Due Date', 'Status'])
        
        log.debug(f"Raw data from sheet: {values[:5]}")  # Log first few rows
        
        # Convert to DataFrame
        df = pd.DataFrame(values[1:], columns=['Date', 'Amount', 'Type', 'Category', 'Description', 'Due Date', 'Status'])
        log.debug(f"Initial DataFrame shape: {df.shape}")
        
        # Log unique values in Status column
        log.debug(f"Unique Status values: {df['Status'].unique()}")
        
        # Filter only pending transactions
        df = df[df['Status'].str.strip().str.upper() == 'PENDING']
        log.debug(f"DataFrame shape after status filter: {df.shape}")
        
        if df.empty:
            log.warning("No pending transactions after filtering")
            return df
        
        # Convert Amount to numeric
        df['Amount'] = pd.to_numeric(df['Amount'], errors='coerce')
        
        # Convert dates
        df['Date'] = parse_sheet_dates(df['Date'])
        df['Due Date'] = parse_sheet_dates(df['Due Date'])
        
        # Drop rows with NaN values
        df = df.dropna(subset=['Amount', 'Type', 'Status'])
        log.debug(f"Final DataFrame shape: {df.shape}")
        
        log.info(f"📊 Retrieved {len(df)} pending transactions")
        return df
    except Exception as e:
        log.error(f"❌ Failed to fetch pending transactions: {str(e)}")
        raise

def initialize_filters():
    """Initialize filter values in session state if they don't exist"""
    current_project = get_current_project()
    if st.session_state.get('global_filter_project') != current_project:
        st.session_state.global_filter_type = "All Time"
        st.session_state.global_selected_year = datetime.now().year
        st.session_state.global_selected_month = datetime.now().month
        st.session_state.global_start_date = datetime.now() - timedelta(days=30)
        st.session_state.global_end_date = datetime.now()
        st.session_state.global_filter_project = current_project

    if 'global_filter_type' not in st.session_state:
        st.session_state.global_filter_type = "All Time"
    if 'global_selected_year' not in st.session_state:
        st.session_state.global_selected_year = datetime.now().year
    if 'global_selected_month' not in st.session_state:
        st.session_state.global_selected_month = datetime.now().month
    if 'global_start_date' not in st.session_state:
        st.session_state.global_start_date = datetime.now() - timedelta(days=30)
    if 'global_end_date' not in st.session_state:
        st.session_state.global_end_date = datetime.now()
    if 'filter_container_created' not in st.session_state:
        st.session_state.filter_container_created = False

def get_date_filters(df: pd.DataFrame, key:str="unique_global_filter"):
    """Common date filter UI component for all analytics"""
    initialize_filters()
    
    st.sidebar.subheader("📅 Date Filter")
    
    # Get min and max dates from the data
    if not df.empty:
        df = df.copy()
        df['Date'] = parse_sheet_dates(df['Date'])
        valid_dates = df['Date'].dropna()
        if valid_dates.empty:
            min_date = max_date = datetime.now()
            available_years = [datetime.now().year]
        else:
            min_date = valid_dates.min()
            max_date = valid_dates.max()
            available_years = sorted(valid_dates.dt.year.unique(), reverse=True)
    else:
        min_date = max_date = datetime.now()
        available_years = [datetime.now().year]
    
    # Filter type selection with unique key
    st.session_state.global_filter_type = st.sidebar.radio(
        "Select Time Period",
        ["All Time", "Year", "Month", "Custom Range"],
        key=key
    )
    
    if st.session_state.global_filter_type == "Year":
        st.session_state.global_selected_year = st.sidebar.selectbox(
            "Select Year",
            available_years,
            key="unique_global_year"
        )
        start_date = datetime(st.session_state.global_selected_year, 1, 1)
        end_date = datetime(st.session_state.global_selected_year, 12, 31)
    
    elif st.session_state.global_filter_type == "Month":
        st.session_state.global_selected_year = st.sidebar.selectbox(
            "Select Year",
            available_years,
            key="unique_global_month_year"
        )
        st.session_state.global_selected_month = st.sidebar.selectbox(
            "Select Month",
            range(1, 13),
            format_func=lambda x: datetime(2000, x, 1).strftime('%B'),
            key="unique_global_month"
        )
        start_date = datetime(st.session_state.global_selected_year, st.session_state.global_selected_month, 1)
        end_date = (datetime(st.session_state.global_selected_year, st.session_state.global_selected_month + 1, 1) 
                   if st.session_state.global_selected_month < 12 
                   else datetime(st.session_state.global_selected_year + 1, 1, 1)) - timedelta(days=1)
    
    elif st.session_state.global_filter_type == "Custom Range":
        col1, col2 = st.sidebar.columns(2)
        with col1:
            st.session_state.global_start_date = st.date_input(
                "Start Date", 
                min_date,
                key="unique_global_start_date"
            )
        with col2:
            st.session_state.global_end_date = st.date_input(
                "End Date", 
                max_date,
                key="unique_global_end_date"
            )
        
        start_date = datetime.combine(st.session_state.global_start_date, datetime.min.time()) # type: ignore
        end_date = datetime.combine(st.session_state.global_end_date, datetime.max.time()) # type: ignore
    
    else:  # All Time
        start_date = min_date
        end_date = max_date
    
    return start_date, end_date

def filter_dataframe(df, start_date, end_date):
    """Filter dataframe based on date range"""
    if df.empty:
        return df
    
    df = df.copy()
    df['Date'] = parse_sheet_dates(df['Date'])
    return df[(df['Date'] >= start_date) & (df['Date'] <= end_date)]

def show_overview_analytics(df, start_date, end_date):
    if df.empty:
        st.info("No transactions found for the selected period.")
        return

    if is_private_flow_project(get_current_project()):
        personal_summary = calculate_personal_summary(df)
        render_personal_overview_cards(
            personal_summary['income_total'],
            personal_summary['expense_total'],
            personal_summary['net_balance'],
        )
        return

    expense_df = df[df['Type'] == 'Expense'].copy()
    if expense_df.empty:
        st.info("No expense transactions found for the selected period.")
        return

    total_expense = expense_df['Amount'].sum()
    payment_summary = calculate_payment_summary(expense_df)
    
    render_overview_cards(
        payment_summary['paid_totals'],  # type: ignore[arg-type]
        total_expense,
        payment_summary['settlement_message'],  # type: ignore[arg-type]
    )

def show_expense_analytics(df, start_date, end_date):
    st.subheader("💸 Expense Analytics")
    expense_df = df[df['Type'] == 'Expense'].copy()
    if expense_df.empty:
        st.info("No expense transactions found for the selected period.")
        return

    income_df = df[df['Type'] == 'Income'].copy()

    if is_private_flow_project(get_current_project()):
        st.subheader("Cash Flow Summary")
        col1, col2, col3 = st.columns(3)
        with col1:
            st.metric("Income", format_currency(income_df['Amount'].sum()))
        with col2:
            st.metric("Expenses", format_currency(expense_df['Amount'].sum()))
        with col3:
            st.metric("Net", format_balance(income_df['Amount'].sum() - expense_df['Amount'].sum()))

        st.subheader("Recent Transactions")
        recent_df = df.sort_values('Date', ascending=False).head(10)
        st.dataframe(
            recent_df[['Date', 'Type', 'Category', 'Amount', 'Description']].style.format({
                'Amount': format_currency,
                'Date': lambda x: x.strftime('%Y-%m-%d')
            }),
            hide_index=True,
            width='stretch',
        )

    st.subheader("Monthly Summary")
    monthly_summary = expense_df.groupby(expense_df['Date'].dt.strftime('%Y-%m'))['Amount'].sum().to_frame('Expense')
    st.dataframe(
        monthly_summary.style.format({
            'Expense': format_currency
        }),
        width='stretch',
        height=200
    )

    st.subheader("Recent Transactions")
    recent_df = expense_df.sort_values('Date', ascending=False).head(5)
    st.dataframe(
        recent_df[['Date', 'Category', 'Amount', 'Description', 'User']].style.format({
            'Amount': format_currency,
            'Date': lambda x: x.strftime('%Y-%m-%d')
        }),
        hide_index=True
    )
    
    # Display selected period
    # st.caption(f"Showing data from {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}")
    
    # Monthly Expense Trend
    monthly_expense = expense_df.groupby(expense_df['Date'].dt.strftime('%Y-%m'))['Amount'].sum()
    fig_monthly = px.bar(monthly_expense, 
                        title='Monthly Expense Trend',
                        labels={'value': 'Amount ($)', 'index': 'Month'})
    st.plotly_chart(fig_monthly)
    
    # Category Analysis
    col1, col2 = st.columns(2)
    with col1:
        # Category Breakdown
        fig_category = px.pie(expense_df, 
                            values='Amount', 
                            names='Category',
                            title='Expenses by Category')
        st.plotly_chart(fig_category)
    
    with col2:
        # Top Expense Categories
        st.subheader("Top Expense Categories")
        top_expenses = expense_df.groupby('Category')['Amount'].sum().sort_values(ascending=False)
        st.dataframe(
            top_expenses.to_frame().style.format({
                'Amount': format_currency
            }),
            width='stretch',
            height=300
        )
    
    # Daily Average Spending
    avg_daily = expense_df.groupby(expense_df['Date'].dt.strftime('%Y-%m'))['Amount'].sum() / 30
    st.subheader("Average Daily Spending by Month")
    st.dataframe(
        avg_daily.to_frame().style.format({
            'Amount': format_currency
        })
    )
    
    # Add Fixed vs Variable Expenses
    st.subheader("📊 Fixed vs Variable Expenses")
    monthly_category = df[df['Type'] == 'Expense'].groupby(['Category', df['Date'].dt.strftime('%Y-%m')])['Amount'].sum()
    category_consistency = monthly_category.groupby('Category').agg(['mean', 'std'])
    category_consistency['variation'] = (category_consistency['std'] / category_consistency['mean']).fillna(0)
    
    # Categories with low variation are likely fixed expenses
    fixed_expenses = category_consistency[category_consistency['variation'] < 0.2]
    variable_expenses = category_consistency[category_consistency['variation'] >= 0.2]
    
    col1, col2 = st.columns(2)
    with col1:
        st.caption("Fixed Expenses (Low Variation)")
        st.dataframe(
            fixed_expenses.style.format({
                'mean': format_currency,
                'std': format_currency,
                'variation': '{:.2%}'
            })
        )
    
    with col2:
        st.caption("Variable Expenses (High Variation)")
        st.dataframe(
            variable_expenses.style.format({
                'mean': format_currency,
                'std': format_currency,
                'variation': '{:.2%}'
            })
        )
    
    # Expense Growth Analysis
    st.subheader("📈 Expense Growth Analysis")
    monthly_total = df[df['Type'] == 'Expense'].groupby(df['Date'].dt.strftime('%Y-%m'))['Amount'].sum()
    monthly_growth = monthly_total.pct_change() * 100
    
    fig_growth = px.line(monthly_growth,
                        title='Month-over-Month Expense Growth Rate',
                        labels={'value': 'Growth Rate (%)', 'index': 'Month'})
    st.plotly_chart(fig_growth)

    st.subheader("💡 Spending Insights")
    col1, col2 = st.columns(2)

    with col1:
        expense_df['Day_Type'] = expense_df['Date'].dt.dayofweek.map(lambda x: 'Weekend' if x >= 5 else 'Weekday')
        daily_avg = expense_df.groupby('Day_Type')['Amount'].agg(['sum', 'count'])
        daily_avg['avg'] = daily_avg['sum'] / daily_avg['count']

        st.caption("Weekday vs Weekend Spending")
        st.dataframe(
            daily_avg.style.format({
                'sum': format_currency,
                'avg': lambda x: f"{format_currency(x)}/day"
            })
        )

    with col2:
        expense_df['Week_of_Month'] = expense_df['Date'].dt.day.map(lambda x: (x - 1) // 7 + 1)
        weekly_spending = expense_df.groupby('Week_of_Month')['Amount'].mean()

        fig_weekly = px.bar(
            weekly_spending,
            title='Average Spending by Week of Month',
            labels={'value': 'Amount ($)', 'Week_of_Month': 'Week'},
        )
        st.plotly_chart(fig_weekly)

def show_pending_transactions():
    """Display pending transactions section"""
    st.subheader("📋 Pending Transactions")
    
    try:
        df = get_pending_transactions()
        
        if df.empty:
            st.info("No pending transactions found.")
            return
        
        # Create tabs for To Receive and To Pay
        to_receive = df[df['Type'] == 'To Receive'].copy()
        to_pay = df[df['Type'] == 'To Pay'].copy()
        
        # Show summary metrics first
        col1, col2, col3 = st.columns(3)
        
        with col1:
            total_to_receive = to_receive['Amount'].sum()
            st.metric("To Receive", format_currency(total_to_receive))
            
        with col2:
            total_to_pay = to_pay['Amount'].sum()
            st.metric("To Pay", format_currency(total_to_pay))
            
        with col3:
            net_pending = total_to_receive - total_to_pay
            st.metric("Net Pending", 
                     format_currency(net_pending),
                     delta=format_currency(net_pending),
                     delta_color="normal" if net_pending >= 0 else "inverse")
        
        st.divider()
        
        tab1, tab2 = st.tabs(["💰 To Receive", "💸 To Pay"])
        
        with tab1:
            if to_receive.empty:
                st.info("No pending receipts.")
            else:
                st.write("### Pending Receipts")
                # Format amount with currency
                to_receive['Amount'] = to_receive['Amount'].apply(format_currency)
                # Format dates
                to_receive['Date'] = to_receive['Date'].dt.strftime('%Y-%m-%d')
                to_receive['Due Date'] = to_receive['Due Date'].dt.strftime('%Y-%m-%d')
                st.dataframe(
                    to_receive[['Date', 'Amount', 'Category', 'Description', 'Due Date']],
                    width='stretch'
                )
        
        with tab2:
            if to_pay.empty:
                st.info("No pending payments.")
            else:
                st.write("### Pending Payments")
                # Format amount with currency
                to_pay['Amount'] = to_pay['Amount'].apply(format_currency)
                # Format dates
                to_pay['Date'] = to_pay['Date'].dt.strftime('%Y-%m-%d')
                to_pay['Due Date'] = to_pay['Due Date'].dt.strftime('%Y-%m-%d')
                st.dataframe(
                    to_pay[['Date', 'Amount', 'Category', 'Description', 'Due Date']],
                    width='stretch'
                )
    except Exception as e:
        log.error(f"Error displaying pending transactions: {str(e)}")
        st.error("Failed to load pending transactions. Please check the logs for details.")

def show_analytics():
    try:
        if not ensure_startup():
            return

        project_name = get_current_project()
        render_global_header()
        render_project_balance_banner(project_name)
        if not is_private_flow_project(project_name):
            render_top_view_navigation("Balances")

        raw_df = get_transactions_data(project_name)

        # Get date filters once for all tabs
        start_date, end_date = get_date_filters(raw_df, key="global_analytics_filter")
        using_fallback_period = False
        
        # Get and filter data
        df = raw_df
        if not df.empty:
            df = df.copy()
            df['Amount'] = pd.to_numeric(df['Amount'], errors='coerce')
            df['Date'] = parse_sheet_dates(df['Date'])
            df = df.dropna(subset=['Amount', 'Date'])
            filtered_df = filter_dataframe(df, start_date, end_date)
            if filtered_df.empty and not df.empty:
                log.warning(
                    "No transactions matched the selected period for project %s. Falling back to all project transactions.",
                    project_name,
                )
                filtered_df = df
                using_fallback_period = True
        else:
            filtered_df = df
        
        # Display selected period
        if using_fallback_period:
            st.caption("Showing all project transactions because the selected period returned no results.")
        else:
            st.caption(f"Showing data from {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}")
        
        # Show tabs for different sections
        tab1, tab2 = st.tabs(["Overview", "Expense Analytics"])
        
        with tab1:
            show_overview_analytics(filtered_df, start_date, end_date)
        with tab2:
            show_expense_analytics(filtered_df, start_date, end_date)
        
        log.info("📊 Analytics visualizations generated successfully")
    except Exception as e:
        log.error(f"❌ Failed to generate analytics: {str(e)}", exc_info=True)
        st.error("Failed to generate analytics. Please try again later.")
        
if __name__ == "__main__":
    show_analytics() 
