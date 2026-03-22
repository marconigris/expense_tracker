from __future__ import annotations

import streamlit as st

st.set_page_config(layout="wide", initial_sidebar_state="expanded")

from home_page import render


def main() -> None:
    render()


if __name__ == "__main__":
    main()
