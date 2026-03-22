from __future__ import annotations

import streamlit as st


def inject_global_styles() -> None:
    """Apply the shared visual language across the app."""
    st.markdown(
        """
        <style>
        :root {
            --app-bg-top: #f7efe3;
            --app-bg-mid: #f7f4ed;
            --app-bg-bottom: #eef4fb;
            --ink-strong: #132238;
            --ink-soft: #5f6c80;
            --line-soft: rgba(19, 34, 56, 0.09);
            --panel-bg: rgba(255, 255, 255, 0.78);
            --panel-strong: rgba(255, 255, 255, 0.92);
            --accent-deep: #103e68;
            --accent-bright: #2f7dc7;
            --accent-warm: #f3a65c;
            --shadow-soft: 0 18px 48px rgba(17, 24, 39, 0.09);
            --shadow-strong: 0 26px 56px rgba(17, 24, 39, 0.14);
            --radius-lg: 1.6rem;
            --radius-md: 1.05rem;
        }

        html, body, [data-testid="stAppViewContainer"], [data-testid="stApp"] {
            background:
                radial-gradient(circle at top left, rgba(243,166,92,0.22), transparent 24%),
                radial-gradient(circle at top right, rgba(47,125,199,0.16), transparent 28%),
                linear-gradient(180deg, var(--app-bg-top) 0%, var(--app-bg-mid) 52%, var(--app-bg-bottom) 100%);
            color: var(--ink-strong);
            font-family: "Avenir Next", "Nunito Sans", "Segoe UI", sans-serif;
        }

        h1, h2, h3, [data-testid="stMarkdownContainer"] h1, [data-testid="stMarkdownContainer"] h2, [data-testid="stMarkdownContainer"] h3 {
            font-family: "Avenir Next Condensed", "Arial Narrow", "Avenir Next", sans-serif;
            letter-spacing: 0.01em;
            color: var(--ink-strong);
        }

        [data-testid="stHeader"] {
            background: transparent;
        }

        [data-testid="stAppViewContainer"] > .main {
            padding-top: 1.15rem;
        }

        [data-testid="stSidebar"] {
            background:
                radial-gradient(circle at top left, rgba(243,166,92,0.12), transparent 28%),
                linear-gradient(180deg, #1f232a 0%, #2d3139 100%);
            border-right: 1px solid rgba(255, 255, 255, 0.05);
        }

        [data-testid="stSidebar"] * {
            color: #ece6dd;
        }

        [data-testid="stSidebar"] [data-testid="stMarkdownContainer"] h3 {
            color: #fff8ef;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            font-size: 0.9rem;
        }

        [data-testid="stSidebar"] button[kind] {
            border-radius: 1rem;
            border: 1px solid rgba(255, 248, 239, 0.08);
            background: rgba(255, 248, 239, 0.04);
            box-shadow: none;
            color: #fff7ed;
            transition: transform 140ms ease, background 140ms ease, border-color 140ms ease;
        }

        [data-testid="stSidebar"] button[kind] p,
        [data-testid="stSidebar"] button[kind] span,
        [data-testid="stSidebar"] button[kind] div {
            color: #fff7ed !important;
        }

        [data-testid="stSidebar"] button[kind]:hover {
            transform: translateY(-1px);
            background: rgba(243, 166, 92, 0.12);
            border-color: rgba(243, 166, 92, 0.2);
        }

        [data-testid="stSidebar"] a {
            color: #ffd7ae !important;
            text-decoration: none;
        }

        .app-shell {
            border-radius: 1.8rem;
            padding: 1.1rem 1.15rem 1.15rem;
            margin: 0.55rem 0 1rem;
            background: linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.62) 100%);
            border: 1px solid var(--line-soft);
            box-shadow: var(--shadow-soft);
            backdrop-filter: blur(12px);
        }

        .app-shell.compact {
            padding-top: 0.9rem;
        }

        .hero-header {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 1rem;
            margin-bottom: 0.9rem;
        }

        .hero-header__eyebrow {
            font-size: 0.76rem;
            text-transform: uppercase;
            letter-spacing: 0.14em;
            color: var(--ink-soft);
            font-weight: 700;
        }

        .hero-header__title {
            font-size: clamp(1.9rem, 4vw, 2.8rem);
            line-height: 0.96;
            letter-spacing: -0.05em;
            font-weight: 800;
            margin-top: 0.15rem;
        }

        .hero-header__subtitle {
            margin-top: 0.35rem;
            color: var(--ink-soft);
            font-size: 0.98rem;
            font-weight: 600;
        }

        .hero-badge {
            padding: 0.55rem 0.8rem;
            border-radius: 999px;
            background: linear-gradient(135deg, rgba(16,62,104,0.08), rgba(243,166,92,0.18));
            border: 1px solid rgba(16,62,104,0.1);
            color: var(--accent-deep);
            font-size: 0.82rem;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            white-space: nowrap;
        }

        [data-testid="stSegmentedControl"] {
            margin: 0.4rem 0 0.8rem;
        }

        [data-testid="stSegmentedControl"] div[role="radiogroup"] {
            padding: 0.24rem;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.72);
            border: 1px solid var(--line-soft);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
        }

        [data-testid="stSegmentedControl"] button {
            border-radius: 999px !important;
            font-weight: 700 !important;
            min-height: 2.7rem;
        }

        [data-testid="stButton"] button,
        [data-testid="stFormSubmitButton"] button {
            border-radius: 999px;
            border: none;
            background: linear-gradient(180deg, var(--accent-deep) 0%, #1e5d92 100%);
            color: #f8fafc !important;
            font-weight: 800;
            letter-spacing: 0.01em;
            box-shadow: 0 18px 36px rgba(16, 62, 104, 0.18);
        }

        [data-testid="stButton"] button p,
        [data-testid="stButton"] button span,
        [data-testid="stButton"] button div,
        [data-testid="stFormSubmitButton"] button p,
        [data-testid="stFormSubmitButton"] button span,
        [data-testid="stFormSubmitButton"] button div {
            color: #f8fafc !important;
        }

        [data-testid="stButton"] button:hover,
        [data-testid="stFormSubmitButton"] button:hover {
            background: linear-gradient(180deg, #0f3354 0%, #205f93 100%);
        }

        [data-testid="stNumberInput"] input,
        [data-testid="stTextInput"] input,
        [data-baseweb="select"] > div,
        textarea {
            border-radius: var(--radius-md) !important;
            border: 1px solid rgba(19, 34, 56, 0.08) !important;
            background: rgba(255, 255, 255, 0.9) !important;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.88);
        }

        [data-testid="stSelectbox"] label,
        [data-testid="stNumberInput"] label,
        [data-testid="stTextInput"] label,
        [data-testid="stDateInput"] label,
        [data-testid="stMarkdownContainer"] p {
            color: var(--ink-strong);
        }

        [data-testid="stAlert"] {
            border-radius: 1.1rem;
            border: 1px solid var(--line-soft);
            box-shadow: var(--shadow-soft);
        }

        details {
            border-radius: 1.2rem;
            background: rgba(255,255,255,0.72);
            border: 1px solid var(--line-soft);
            box-shadow: var(--shadow-soft);
        }

        [data-testid="stTabs"] button[role="tab"] {
            border-radius: 999px;
            font-weight: 700;
        }

        [data-testid="stDataFrame"] {
            border-radius: 1.2rem;
            overflow: hidden;
            box-shadow: var(--shadow-soft);
        }

        @media (max-width: 640px) {
            .app-shell {
                border-radius: 1.3rem;
                padding: 0.95rem;
            }

            .hero-header {
                flex-direction: column;
                align-items: flex-start;
            }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )
