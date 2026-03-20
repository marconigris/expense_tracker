import os
import streamlit as st
from google import genai
from typing import Any


@st.cache_resource
def get_gemini_client() -> Any:
    """Cache Gemini AI client"""
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable not set")
    client = genai.Client(api_key=api_key)
    return client


MODEL = 'gemini-2.0-flash'


def generate_text(prompt: str) -> str:
    """Generate text using Gemini AI"""
    client = get_gemini_client()
    response = client.models.generate_content(
        model=MODEL,
        contents=prompt
    )
    return response.text
