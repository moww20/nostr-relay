#!/usr/bin/env python3
"""
Simple NOSTR client for testing the relay
"""

import asyncio
import json
import websockets
import time
import hashlib
import hmac
import base64
from typing import Dict, Any

class NostrTestClient:
    def __init__(self, relay_url: str = "wss://relay.twatter.army"):
        self.relay_url = relay_url
        self.websocket = None

    async def connect(self):
        """Connect to the relay"""
        try:
            self.websocket = await websockets.connect(self.relay_url)
            print(f"Connected to {self.relay_url}")
        except Exception as e:
            print(f"Failed to connect: {e}")
            raise

    async def disconnect(self):
        """Disconnect from the relay"""
        if self.websocket:
            await self.websocket.close()
            print("Disconnected from relay")

    async def send_event(self, event: Dict[str, Any]):
        """Send an EVENT message to the relay"""
        message = {
            "type": "EVENT",
            "event": event
        }
        
        await self.websocket.send(json.dumps(message))
        print(f"Sent event: {event.get('id', 'unknown')}")

    async def send_request(self, subscription_id: str, filters: list):
        """Send a REQ message to the relay"""
        message = {
            "type": "REQ",
            "subscription_id": subscription_id,
            "filters": filters
        }
        
        await self.websocket.send(json.dumps(message))
        print(f"Sent request with subscription: {subscription_id}")

    async def send_close(self, subscription_id: str):
        """Send a CLOSE message to the relay"""
        message = {
            "type": "CLOSE",
            "subscription_id": subscription_id
        }
        
        await self.websocket.send(json.dumps(message))
        print(f"Closed subscription: {subscription_id}")

    async def listen_for_messages(self):
        """Listen for messages from the relay"""
        try:
            async for message in self.websocket:
                data = json.loads(message)
                print(f"Received: {data}")
        except websockets.exceptions.ConnectionClosed:
            print("Connection closed")
        except Exception as e:
            print(f"Error receiving message: {e}")

    async def run_test(self):
        """Run a complete test of the relay"""
        await self.connect()
        
        # Start listening for messages in the background
        listener_task = asyncio.create_task(self.listen_for_messages())
        
        try:
            # Test 1: Send a simple event
            test_event = {
                "id": "test_event_id_123",
                "pubkey": "test_pubkey_456",
                "created_at": int(time.time()),
                "kind": 1,
                "tags": [["t", "test"]],
                "content": "Hello from Python test client!",
                "sig": "test_signature_789"
            }
            
            await self.send_event(test_event)
            await asyncio.sleep(1)
            
            # Test 2: Send a request
            filters = [{
                "kinds": [1],
                "limit": 10
            }]
            
            await self.send_request("test_sub_1", filters)
            await asyncio.sleep(2)
            
            # Test 3: Close the subscription
            await self.send_close("test_sub_1")
            await asyncio.sleep(1)
            
        finally:
            # Cancel the listener task
            listener_task.cancel()
            await self.disconnect()

async def main():
    """Main function to run the test"""
    client = NostrTestClient()
    await client.run_test()

if __name__ == "__main__":
    print("Starting NOSTR relay test client...")
    asyncio.run(main())
