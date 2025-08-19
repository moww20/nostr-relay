#!/usr/bin/env python3
"""
Simple test script for the NOSTR indexer API
"""

import requests
import json
import time

def test_health():
    """Test health endpoint"""
    print("🔍 Testing health endpoint...")
    try:
        response = requests.get("http://localhost:8080/api/health")
        print(f"  Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"  Response: {data}")
            return True
        else:
            print(f"  Error: {response.reason}")
            return False
    except Exception as e:
        print(f"  Exception: {e}")
        return False

def test_search():
    """Test search endpoint"""
    print("🔍 Testing search endpoint...")
    try:
        response = requests.get("http://localhost:8080/api/search?q=alice&page=0&per_page=10")
        print(f"  Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"  Found {data.get('data', {}).get('total_count', 0)} profiles")
            return True
        else:
            print(f"  Error: {response.reason}")
            return False
    except Exception as e:
        print(f"  Exception: {e}")
        return False

def test_indexer_stats():
    """Test indexer stats endpoint"""
    print("🔍 Testing indexer stats endpoint...")
    try:
        response = requests.get("http://localhost:8080/api/indexer-stats")
        print(f"  Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            stats = data.get('data', {})
            print(f"  Total profiles: {stats.get('total_profiles', 0)}")
            print(f"  Total relationships: {stats.get('total_relationships', 0)}")
            print(f"  Relays indexed: {stats.get('relays_indexed', 0)}")
            return True
        else:
            print(f"  Error: {response.reason}")
            return False
    except Exception as e:
        print(f"  Exception: {e}")
        return False

def main():
    """Main test function"""
    print("🚀 Starting NOSTR Indexer API Tests")
    print("=" * 50)
    
    tests = [
        ("Health Check", test_health),
        ("Search Profiles", test_search),
        ("Indexer Stats", test_indexer_stats),
    ]
    
    results = []
    for test_name, test_func in tests:
        print(f"\n📋 {test_name}")
        print("-" * 30)
        try:
            result = test_func()
            results.append((test_name, result))
            if result:
                print(f"✅ {test_name} - PASSED")
            else:
                print(f"❌ {test_name} - FAILED")
        except Exception as e:
            print(f"❌ {test_name} - ERROR: {e}")
            results.append((test_name, False))
    
    print("\n" + "=" * 50)
    print("📊 Test Results Summary")
    print("=" * 50)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"  {test_name}: {status}")
    
    print(f"\n🎯 Overall: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! The indexer is working correctly.")
    else:
        print("⚠️  Some tests failed. Check the indexer logs for details.")

if __name__ == "__main__":
    main()
