#!/usr/bin/env python3
"""
Test if backend can import without errors
"""
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

try:
    import app.main
    print("✅ Backend imports successfully!")
    print("✅ Union import fixed!")
except ImportError as e:
    print(f"❌ Import error: {e}")
except NameError as e:
    print(f"❌ Name error: {e}")
except Exception as e:
    print(f"❌ Other error: {e}")

