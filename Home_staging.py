from __future__ import annotations

import os

os.environ["APP_ENV"] = "staging"
os.environ["GOOGLE_SHEET_ID"] = "1qv2AF8aF-Cq0pBtD9igCQP76Kj7vDq4yq06tCQZgcKg"

import streamlit as st

st.set_page_config(layout="wide", initial_sidebar_state="expanded")

from home_page import render


def main() -> None:
    render()


if __name__ == "__main__":
    main()
