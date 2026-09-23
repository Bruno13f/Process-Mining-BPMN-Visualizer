import asyncio

import jupyter_client

# === Persistent kernel for caching imports ===
persistent_kernel_manager = None
persistent_kernel_client = None
kernel_initialized = False


async def get_or_create_kernel():
    """Get existing kernel or create a new one with pre-warmed imports."""
    global persistent_kernel_manager, persistent_kernel_client, kernel_initialized

    # If kernel exists and is alive, return it
    if persistent_kernel_manager and persistent_kernel_client:
        try:
            if persistent_kernel_manager.is_alive():
                return persistent_kernel_manager, persistent_kernel_client
        except Exception:
            pass

    # Create new kernel
    persistent_kernel_manager = jupyter_client.KernelManager(kernel_name="pm4py-venv")
    persistent_kernel_manager.start_kernel()
    persistent_kernel_client = persistent_kernel_manager.client()
    persistent_kernel_client.start_channels()

    # Wait for kernel to be ready
    await asyncio.sleep(3)

    # Pre-warm imports on first use
    if not kernel_initialized:
        warmup_code = """
import pm4py
from lxml import etree
import pandas
import re
import numpy
import sentence_transformers
import rapidfuzz
import matplotlib
import matplotlib.pyplot as plt
import seaborn
import nltk
import spacy
print("✅ Kernel pre-warmed with imports")
"""
        msg_id = persistent_kernel_client.execute(warmup_code)

        # Wait for warmup to complete
        max_wait = 60
        start_time = asyncio.get_event_loop().time()
        while True:
            if asyncio.get_event_loop().time() - start_time > max_wait:
                break
            try:
                msg = persistent_kernel_client.get_iopub_msg(timeout=1)
                if msg["parent_header"].get("msg_id") != msg_id:
                    continue
                if msg["header"]["msg_type"] == "status" and msg["content"]["execution_state"] == "idle":
                    break
            except Exception:
                continue

        kernel_initialized = True

    return persistent_kernel_manager, persistent_kernel_client


async def reset_kernel_namespace():
    """Reset kernel namespace while keeping imports cached."""
    global persistent_kernel_client

    if persistent_kernel_client:
        # Reset only user-defined variables, keep imports
        reset_code = """
# Delete all user-defined variables except imports
import sys
_module_names = set(sys.modules.keys())
for name in list(globals().keys()):
    if not name.startswith('_') and name not in _module_names and name not in ['In', 'Out', 'get_ipython', 'exit', 'quit']:
        try:
            del globals()[name]
        except:
            pass
print("✅ Namespace reset (imports preserved)")
"""
        msg_id = persistent_kernel_client.execute(reset_code)

        # Wait for reset to complete
        max_wait = 5
        start_time = asyncio.get_event_loop().time()
        while True:
            if asyncio.get_event_loop().time() - start_time > max_wait:
                break
            try:
                msg = persistent_kernel_client.get_iopub_msg(timeout=1)
                if msg["parent_header"].get("msg_id") != msg_id:
                    continue
                if msg["header"]["msg_type"] == "status" and msg["content"]["execution_state"] == "idle":
                    break
            except Exception:
                continue


async def interrupt_kernel_execution():
    """Interrupt currently running kernel execution, if any."""
    global persistent_kernel_manager

    if persistent_kernel_manager:
        try:
            persistent_kernel_manager.interrupt_kernel()
        except Exception:
            # Best-effort interrupt.
            pass
