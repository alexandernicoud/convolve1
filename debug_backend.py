#!/usr/bin/env python3
"""
Simple script to test if the backend is working
"""
import requests
import time

def test_backend():
    url = "http://127.0.0.1:8001/runs/active"
    try:
        print(f"Testing connection to: {url}")
        response = requests.get(url, timeout=5)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text}")
        return True
    except requests.exceptions.ConnectionError:
        print("❌ Connection failed - backend is not running or not accessible")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    print("🔍 Testing backend connection...")
    if test_backend():
        print("✅ Backend is responding!")
    else:
        print("❌ Backend is not accessible")
        print("\n💡 Make sure to run:")
        print("   cd backend && MPLCONFIGDIR=/tmp/matplotlib MPLBACKEND=Agg python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload")

