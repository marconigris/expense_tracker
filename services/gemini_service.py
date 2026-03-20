import os
import streamlit as st
from google import genai
from google.genai.errors import ClientError
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
    try:
        response = client.models.generate_content(
            model=MODEL,
            contents=prompt
        )
        return response.text
    except ClientError as e:
        if '429' in str(e) or 'RESOURCE_EXHAUSTED' in str(e):
            raise RuntimeError(
                "El limite de solicitudes gratuitas de Gemini AI fue alcanzado. "
                "Por favor espera un minuto e intenta de nuevo. "
                "(Free tier: 15 requests/min, 1500 requests/day)"
            )
        raise
    except Exception as e:
        if 'RESOURCE_EXHAUSTED' in str(e) or '429' in str(e):
            raise RuntimeError(
                "El limite de solicitudes gratuitas de Gemini AI fue alcanzado. "
                "Por favor espera un minuto e intenta de nuevo."
            )
        raise
