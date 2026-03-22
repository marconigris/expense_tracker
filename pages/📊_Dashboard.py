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
from bootstrap import ensure_startup
from state import get_current_project
from services.google_sheets import verify_sheets_setup

log = setup_logging("expense_tracker_analytics")

st.set_page_config (layout='wide')


def format_currency(amount: float) -> str:
    return f"${amount:,.2f}"


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
]


def format_balance(amount: float) -> str:
    if abs(amount) < 0.01:
        return "$0.00"
    if amount > 0:
        return f"+{format_currency(amount)}"
    return f"-{format_currency(abs(amount))}"


def calculate_user_balances(expense_df: pd.DataFrame) -> dict[str, float]:
    normalized_users = expense_df['User'].fillna('').str.strip().str.lower()
    marco_share = pd.to_numeric(expense_df['Marco Split %'], errors='coerce').fillna(0.0)
    moni_share = pd.to_numeric(expense_df['Moni Split %'], errors='coerce').fillna(0.0)

    no_split_data = (marco_share + moni_share) == 0
    marco_share = marco_share.where(~no_split_data, (normalized_users == 'marconigris').astype(float) * 100)
    moni_share = moni_share.where(~no_split_data, (normalized_users == 'monigila').astype(float) * 100)

    marco_paid = expense_df.loc[normalized_users == 'marconigris', 'Amount'].sum()
    moni_paid = expense_df.loc[normalized_users == 'monigila', 'Amount'].sum()
    marco_owed = (expense_df['Amount'] * (marco_share / 100)).sum()
    moni_owed = (expense_df['Amount'] * (moni_share / 100)).sum()

    return {
        'Marco': marco_paid - marco_owed,
        'Moni': moni_paid - moni_owed,
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


def parse_sheet_dates(series: pd.Series) -> pd.Series:
    """Parse Google Sheets serial dates and regular date strings."""
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


def render_overview_cards(user_balances: dict[str, float], total_expense: float, settlement_message: str) -> None:
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
                    <div class="overview-value">{format_balance(user_balances["Marco"])}</div>
                </div>
                <div class="overview-card">
                    <div class="overview-label">Moni</div>
                    <div class="overview-value">{format_balance(user_balances["Moni"])}</div>
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


def build_settlement_message(user_balances: dict[str, float]) -> str:
    marco_total = user_balances["Marco"]
    moni_total = user_balances["Moni"]

    if abs(marco_total) < 0.01 and abs(moni_total) < 0.01:
        return "Marco and Moni are settled up"

    if marco_total > 0 and moni_total < 0:
        return f"Moni owes Marco {format_currency(abs(moni_total))}"

    if moni_total > 0 and marco_total < 0:
        return f"Marco owes Moni {format_currency(abs(marco_total))}"

    return "Split data needs review"

# Load environment variables
load_dotenv()

@st.cache_resource
def get_google_sheets_service():
    """Cache Google Sheets credentials and service"""
    try:
        creds = service_account.Credentials.from_service_account_info(
            json.loads(os.getenv('GOOGLE_SHEETS_CREDENTIALS')),
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
except Exception:
    st.error("Failed to connect to Google Sheets. Please check your credentials.")
    sys.exit(1)

@st.cache_data(ttl=300)  # Cache for 5 minutes
def get_transactions_data(project_name: str):
    try:
        log.debug("Fetching transactions data from Google Sheets")
        result = service.spreadsheets().values().get(
            spreadsheetId=SHEET_ID,
            range=f'{project_name}!A1:J'
        ).execute()
        
        values = result.get('values', [])
        if not values:
            log.warning("No transaction data found in sheet")
            return pd.DataFrame(columns=TRANSACTION_COLUMNS)
        log.info(f" Retrieved {len(values)-1} transaction records")
        return normalize_transactions_dataframe(values)
    except Exception as e:
        if "Unable to parse range" in str(e):
            log.warning(f"Missing range for project {project_name}. Re-verifying sheet setup and retrying once.")
            if verify_sheets_setup():
                result = service.spreadsheets().values().get(
                    spreadsheetId=SHEET_ID,
                    range=f'{project_name}!A1:J'
                ).execute()
                values = result.get('values', [])
                if not values:
                    return pd.DataFrame(columns=TRANSACTION_COLUMNS)
                return normalize_transactions_dataframe(values)
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

def get_date_filters(key:str="unique_global_filter"):
    """Common date filter UI component for all analytics"""
    initialize_filters()
    
    st.sidebar.subheader("📅 Date Filter")
    
    # Get min and max dates from the data
    df = get_transactions_data(get_current_project())
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
    st.subheader("📈 Expense Overview")
    if df.empty:
        st.info("No transactions found for the selected period.")
        return
    
    # Filter data
    df = filter_dataframe(df, start_date, end_date)
    
    # Display selected period
    # st.caption(f"Showing data from {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}")
    
    expense_df = df[df['Type'] == 'Expense'].copy()
    if expense_df.empty:
        st.info("No expense transactions found for the selected period.")
        return

    total_expense = expense_df['Amount'].sum()
    user_balances = calculate_user_balances(expense_df)
    settlement_message = build_settlement_message(user_balances)
    
    render_overview_cards(user_balances, total_expense, settlement_message)
    
    # Monthly Summary
    st.subheader("Monthly Summary")
    monthly_summary = expense_df.groupby(expense_df['Date'].dt.strftime('%Y-%m'))['Amount'].sum().to_frame('Expense')
    
    # Monthly trend chart
    fig_monthly = px.bar(monthly_summary, 
                        title='Monthly Expenses',
                        labels={'value': 'Amount ($)', 'index': 'Month'})
    st.plotly_chart(fig_monthly)
    
    # Show monthly summary table
    st.dataframe(
        monthly_summary.style.format({
            'Expense': format_currency
        }),
        use_container_width=True,
        height=200
    )
    
    # Recent Transactions
    st.subheader("Recent Transactions")
    recent_df = expense_df.sort_values('Date', ascending=False).head(5)
    st.dataframe(
        recent_df[['Date', 'Category', 'Amount', 'Description', 'User']].style.format({
            'Amount': format_currency,
            'Date': lambda x: x.strftime('%Y-%m-%d')
        }),
        hide_index=True
    )
    
    expense_by_category = expense_df.groupby('Category')['Amount'].sum().sort_values(ascending=False).head(5)
    fig_expense = px.pie(values=expense_by_category.values,
                       names=expense_by_category.index,
                       title='Top Expense Categories')
    st.plotly_chart(fig_expense)
    
    # Add Spending Patterns Analysis
    st.subheader("💡 Spending Insights")
    col1, col2 = st.columns(2)
    
    with col1:
        # Weekday vs Weekend spending
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
        # Week of month analysis
        expense_df['Week_of_Month'] = expense_df['Date'].dt.day.map(lambda x: (x-1)//7 + 1)
        weekly_spending = expense_df.groupby('Week_of_Month')['Amount'].mean()
        
        fig_weekly = px.bar(weekly_spending,
                          title='Average Spending by Week of Month',
                          labels={'value': 'Amount ($)', 'Week_of_Month': 'Week'})
        st.plotly_chart(fig_weekly)

def show_expense_analytics(df, start_date, end_date):
    st.subheader("💸 Expense Analytics")
    expense_df = df[df['Type'] == 'Expense'].copy()
    if expense_df.empty:
        st.info("No expense transactions found for the selected period.")
        return
    
    # Filter data
    df = filter_dataframe(df, start_date, end_date)
    
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
            use_container_width=True,
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
                    use_container_width=True
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
                    use_container_width=True
                )
    except Exception as e:
        log.error(f"Error displaying pending transactions: {str(e)}")
        st.error("Failed to load pending transactions. Please check the logs for details.")

def show_analytics():
    try:
        if not ensure_startup():
            return

        # Get date filters once for all tabs
        start_date, end_date = get_date_filters(key="global_analytics_filter")
        
        # Get and filter data
        df = get_transactions_data(get_current_project())
        if not df.empty:
            df = df.copy()
            df['Amount'] = pd.to_numeric(df['Amount'], errors='coerce')
            df['Date'] = parse_sheet_dates(df['Date'])
            df = df.dropna(subset=['Amount', 'Date'])
            filtered_df = filter_dataframe(df, start_date, end_date)
        else:
            filtered_df = df
        
        # Display selected period
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
