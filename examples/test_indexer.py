#!/usr/bin/env python3
"""
Test script for the NOSTR indexer API
"""

import asyncio
import aiohttp
import json
import time

class IndexerTester:
    def __init__(self, base_url: str = "http://localhost:8080"):
        self.base_url = base_url
        self.session = None

    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()

    async def test_health(self):
        """Test health endpoint"""
        print("🔍 Testing health endpoint...")
        try:
            async with self.session.get(f"{self.base_url}/api/health") as response:
                print(f"  Status: {response.status}")
                if response.status == 200:
                    data = await response.json()
                    print(f"  Response: {data}")
                    return True
                else:
                    print(f"  Error: {response.reason}")
                    return False
        except Exception as e:
            print(f"  Exception: {e}")
            return False

    async def test_search(self, query: str = "alice"):
        """Test search endpoint"""
        print(f"🔍 Testing search endpoint with query: '{query}'...")
        try:
            url = f"{self.base_url}/api/search?q={query}&page=0&per_page=10"
            async with self.session.get(url) as response:
                print(f"  Status: {response.status}")
                if response.status == 200:
                    data = await response.json()
                    print(f"  Found {data.get('data', {}).get('total_count', 0)} profiles")
                    return True
                else:
                    print(f"  Error: {response.reason}")
                    return False
        except Exception as e:
            print(f"  Exception: {e}")
            return False

    async def test_indexer_stats(self):
        """Test indexer stats endpoint"""
        print("🔍 Testing indexer stats endpoint...")
        try:
            async with self.session.get(f"{self.base_url}/api/indexer-stats") as response:
                print(f"  Status: {response.status}")
                if response.status == 200:
                    data = await response.json()
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

    async def test_profile_endpoint(self, pubkey: str = "02f00fdee05e934563f15b2c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5c8c5"):
        """Test profile endpoint"""
        print(f"🔍 Testing profile endpoint for pubkey: {pubkey[:20]}...")
        try:
            async with self.session.get(f"{self.base_url}/api/profile/{pubkey}") as response:
                print(f"  Status: {response.status}")
                if response.status == 200:
                    data = await response.json()
                    print(f"  Profile found: {data.get('success', False)}")
                    return True
                elif response.status == 404:
                    print("  Profile not found (expected for test pubkey)")
                    return True
                else:
                    print(f"  Error: {response.reason}")
                    return False
        except Exception as e:
            print(f"  Exception: {e}")
            return False

    async def run_all_tests(self):
        """Run all tests"""
        print("🚀 Starting NOSTR Indexer API Tests")
        print("=" * 50)

        tests = [
            ("Health Check", self.test_health),
            ("Search Profiles", self.test_search),
            ("Indexer Stats", self.test_indexer_stats),
            ("Profile Endpoint", self.test_profile_endpoint),
        ]

        results = []
        for test_name, test_func in tests:
            print(f"\n📋 {test_name}")
            print("-" * 30)
            try:
                result = await test_func()
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

async def main():
    """Main function"""
    async with IndexerTester() as tester:
        await tester.run_all_tests()

if __name__ == "__main__":
    print("Starting NOSTR Indexer API tests...")
    asyncio.run(main())
