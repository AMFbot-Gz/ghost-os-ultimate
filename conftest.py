"""Conftest racine — requis par pytest >= 7.2 pour pytest_plugins au top-level."""
import sys
import os

# Active le mode asyncio automatique pour tous les tests async
pytest_plugins = ['pytest_asyncio']

# Ajoute agent/ au path pour les imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'agent'))
