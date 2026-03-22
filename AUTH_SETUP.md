# Authentication Setup Guide

This app uses **streamlit-authenticator** for secure multi-user login.

## Setup Instruction

### 1. Generate User Credentials

Run the setup script to create users and generate hashed passwords:

```bash
python scripts/generate_auth_users.py
```

**What it does:**
- Prompts you to enter each username, name, email, and password
- Hashes the passwords securely
- Creates `config/auth_users.yaml` with all credentials

**Example:**
```
Username: marco
Full name: Marco Nigris
Email: marco@example.com
Password: (enter a password)

Username: juan
Full name: Juan
Email: juan@example.com
Password: (enter a password)

Username: sofia
Full name: Sofia
Email: sofia@example.com
Password: (enter a password)
```

### 2. Restart the App

After running the script, restart the Streamlit app:

```bash
streamlit run app.py
```

### 3. Login

Users can now:
1. Open the app
2. See the login form
3. Enter their username and password
4. Access the expense tracker
5. Click "logout" in sidebar to switch users

## Security Notes

- ✅ Passwords are **hashed** (never stored in plain text)
- ✅ Session cookies expire after 30 days
- ✅ Each user session is tracked separately
- ⚠️ Keep `config/auth_users.yaml` secure (don't commit to GitHub)

## File Locations

- **Credentials:** `config/auth_users.yaml`
- **Auth service:** `services/auth_service.py`
- **Setup script:** `scripts/generate_auth_users.py`

## Regenerate Credentials

To add new users or change passwords, run the setup script again:

```bash
python scripts/generate_auth_users.py
```

It will overwrite the existing `auth_users.yaml` with new credentials.
