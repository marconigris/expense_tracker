#!/usr/bin/env python3
"""
Helper script to generate hashed passwords for streamlit-authenticator.

Usage:
  python generate_auth_credentials.py
"""

import streamlit_authenticator as stauth
import yaml
from pathlib import Path


def generate_password_hash(password: str) -> str:
    """Generate hashed password for a given password."""
    return stauth.Hasher.hash(password)


def setup_auth_users():
    """Generate hashed passwords and create auth_users.yaml."""
    
    print("=" * 50)
    print("Streamlit Authenticator Setup")
    print("=" * 50)
    print("\nEnter user credentials (press Ctrl+C to exit)")
    print()
    
    users = {}
    
    while True:
        username = input("\nUsername (or press Enter to finish): ").strip()
        if not username:
            break
        
        if username in users:
            print(f"⚠️  User '{username}' already exists!")
            continue
        
        name = input(f"Full name for '{username}': ").strip()
        email = input(f"Email for '{username}': ").strip()
        password = input(f"Password for '{username}': ").strip()
        
        if not password:
            print("⚠️  Password cannot be empty!")
            continue
        
        hashed_password = generate_password_hash(password)
        
        users[username] = {
            "email": email,
            "name": name,
            "password": hashed_password
        }
        
        print(f"✅ User '{username}' added successfully!")
    
    if not users:
        print("No users provided!")
        return
    
    # Create config dict
    config = {
        'credentials': {
            'usernames': users
        },
        'cookie': {
            'expiry_days': 30,
            'key': 'chetti_expense_tracker_key_2026',
            'name': 'chetti_cookie'
        },
        'pre-authorized': {
            'emails': []
        }
    }
    
    # Write to auth_users.yaml
    auth_path = Path(__file__).parent / "config" / "auth_users.yaml"
    auth_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(auth_path, 'w') as file:
        yaml.dump(config, file, default_flow_style=False)
    
    print("\n" + "=" * 50)
    print(f"✅ Credentials saved to: {auth_path}")
    print("=" * 50)
    print(f"\nUsers created: {', '.join(users.keys())}")
    print("\nDone! Restart the Streamlit app.")


if __name__ == "__main__":
    try:
        setup_auth_users()
    except KeyboardInterrupt:
        print("\n\nCancelled.")
    except Exception as e:
        print(f"\n❌ Error: {e}")
