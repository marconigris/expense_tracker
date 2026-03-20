from __future__ import annotations

import streamlit as st

from home_page import render as render_home


def main() -> None:
    # Por ahora solo Home; después acá podemos agregar tabs o sidebar para dashboard
    render_home()


if __name__ == "__main__":
    main()
