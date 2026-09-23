import asyncio
from typing import Dict, Optional

from fastapi import WebSocket

# === In-memory runtime storage ===
jobs: Dict[str, Dict] = {}
connections: Dict[str, WebSocket] = {}
analysis_results: Dict[str, Dict] = {}
mapping_confirmations: Dict[str, asyncio.Event] = {}
user_confirmed_mappings: Dict[str, list] = {}
job_cancellations: Dict[str, bool] = {}
uploaded_files: Dict[str, list] = {}

# === Backend readiness ===
backend_ready = False
backend_startup_error: Optional[str] = None
