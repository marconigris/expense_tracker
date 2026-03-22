TRANSACTION_TYPES = ['Income', 'Expense', 'To Receive', 'To Pay']

DEFAULT_PROJECT = "Cabarete"

PROJECTS = {
    "Cabarete": {
        "default_currency": "USD",
    },
    "Hymerlife": {
        "default_currency": "EUR",
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
