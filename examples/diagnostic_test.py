#!/usr/bin/env python3
"""
Diagnostic script for testing relay.twatter.army
"""

import asyncio
import aiohttp
import websockets
import json
import time
from urllib.parse import urlparse

async def test_http_endpoints():
    """Test HTTP endpoints"""
    print("🔍 Testing HTTP endpoints...")
    
    base_url = "https://relay.twatter.army"
    endpoints = ["/", "/health"]
    
    async with aiohttp.ClientSession() as session:
        for endpoint in endpoints:
            url = base_url + endpoint
            try:
                print(f"  Testing {url}...")
                async with session.get(url) as response:
                    print(f"    Status: {response.status}")
                    print(f"    Headers: {dict(response.headers)}")
                    if response.status == 200:
                        content = await response.text()
                        print(f"    Content: {content[:200]}...")
                    else:
                        print(f"    Error: {response.reason}")
            except Exception as e:
                print(f"    Exception: {e}")
            print()

async def test_websocket_connection():
    """Test WebSocket connection"""
    print("🔌 Testing WebSocket connection...")
    
    relay_url = "wss://relay.twatter.army"
    
    try:
        print(f"  Connecting to {relay_url}...")
        websocket = await websockets.connect(relay_url)
        print("    ✅ WebSocket connection successful!")
        
        # Test basic NOSTR protocol
        print("  Testing NOSTR protocol...")
        
        # Send a simple REQ message
        req_message = {
            "type": "REQ",
            "subscription_id": "test_diagnostic",
            "filters": [{"kinds": [1], "limit": 1}]
        }
        
        await websocket.send(json.dumps(req_message))
        print("    ✅ REQ message sent successfully")
        
        # Wait for response
        try:
            response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
            print(f"    ✅ Received response: {response}")
        except asyncio.TimeoutError:
            print("    ⚠️  No response received within 5 seconds")
        
        await websocket.close()
        print("    ✅ WebSocket connection closed")
        
    except Exception as e:
        print(f"    ❌ WebSocket connection failed: {e}")
        print(f"    Error type: {type(e).__name__}")

async def test_dns_resolution():
    """Test DNS resolution"""
    print("🌐 Testing DNS resolution...")
    
    import socket
    
    try:
        ip = socket.gethostbyname("relay.twatter.army")
        print(f"  ✅ DNS resolved to: {ip}")
    except Exception as e:
        print(f"  ❌ DNS resolution failed: {e}")

async def test_ssl_certificate():
    """Test SSL certificate"""
    print("🔒 Testing SSL certificate...")
    
    import ssl
    import socket
    
    try:
        context = ssl.create_default_context()
        with socket.create_connection(("relay.twatter.army", 443)) as sock:
            with context.wrap_socket(sock, server_hostname="relay.twatter.army") as ssock:
                cert = ssock.getpeercert()
                print(f"  ✅ SSL certificate valid")
                print(f"    Subject: {cert.get('subject', 'N/A')}")
                print(f"    Issuer: {cert.get('issuer', 'N/A')}")
    except Exception as e:
        print(f"  ❌ SSL certificate test failed: {e}")

async def main():
    """Run all diagnostic tests"""
    print("🚀 Starting diagnostic tests for relay.twatter.army")
    print("=" * 60)
    
    await test_dns_resolution()
    print()
    
    await test_ssl_certificate()
    print()
    
    await test_http_endpoints()
    print()
    
    await test_websocket_connection()
    print()
    
    print("=" * 60)
    print("🏁 Diagnostic tests completed")

if __name__ == "__main__":
    asyncio.run(main())
