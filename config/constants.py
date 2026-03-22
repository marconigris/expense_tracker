TRANSACTION_TYPES = ['Income', 'Expense', 'To Receive', 'To Pay']

DEFAULT_PROJECT = "Cabarete"

PROJECTS = {
    "Cabarete": {
        "default_currency": "USD",
        "type": "shared",
    },
    "Hymerlife": {
        "default_currency": "EUR",
        "type": "shared",
    },
    "Cash USD": {
        "default_currency": "USD",
        "type": "personal",
        "allowed_users": ["marconigris"],
    },
    "Cash EUR": {
        "default_currency": "EUR",
        "type": "personal",
        "allowed_users": ["marconigris"],
    },
}

CATEGORIES = {
    'Expense': {
        'Home': [],
        'Food': [],
        'Transport': [],
        'Eating Out': [],
        'Trips': [],
    },
    'Income': {
        'Salary': ['Regular', 'Bonus', 'Overtime'],
        'Investment': ['Dividends', 'Interest', 'Capital Gains'],
        'Other': ['Gifts', 'Refunds', 'Miscellaneous']
    },
    'To Receive': {
        'Pending Income': ['Salary', 'Investment', 'Other']
    },
    'To Pay': {
        'Bills': ['Utilities', 'Rent', 'Other'],
        'Debt': ['Credit Card', 'Loan', 'Other']
    }
}


def get_project_config(project_name: str) -> dict:
    """Return project metadata, falling back to the default project config."""
    return PROJECTS.get(project_name, PROJECTS[DEFAULT_PROJECT])


def get_visible_projects(username: str | None) -> list[str]:
    """Return projects available to the authenticated user."""
    normalized_username = (username or "").strip().lower()
    visible_projects: list[str] = []

    for project_name, project_config in PROJECTS.items():
        allowed_users = project_config.get("allowed_users")
        if allowed_users and normalized_username not in {user.lower() for user in allowed_users}:
            continue
        visible_projects.append(project_name)

    return visible_projects


def is_personal_project(project_name: str) -> bool:
    """Whether the project uses personal-accounting behavior."""
    return get_project_config(project_name).get("type") == "personal"
