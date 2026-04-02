from __future__ import annotations

import streamlit as st

st.set_page_config(layout="wide", initial_sidebar_state="expanded")


def main() -> None:
    from home_page import render
    render()


if __name__ == "__main__":
    main()
