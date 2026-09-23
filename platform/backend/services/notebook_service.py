import asyncio
import os
import queue
import re

import nbformat

from core import state
from services.kernel_service import get_or_create_kernel, reset_kernel_namespace


class PipelineCancelledError(Exception):
    """Raised when a running pipeline is cancelled by the user."""


async def send_output(job_id: str, message: str, progress: dict = None):
    """Send streaming messages to WebSocket if connected."""
    if job_id in state.connections:
        try:
            payload = {
                "event": "cell_output",
                "message": message,
            }
            # Add progress information if provided
            if progress:
                payload["progress"] = progress

            await state.connections[job_id].send_json(payload)
        except Exception:
            # If socket is closed unexpectedly
            state.connections.pop(job_id, None)


async def run_notebook(job_id: str, bpmn_path: str = None, xes_path: str = None, notebook_path="pipeline.ipynb"):
    """Execute a notebook cell by cell and stream outputs in real-time."""
    state.jobs[job_id] = {"status": "running", "output": []}

    try:
        if state.job_cancellations.get(job_id):
            raise PipelineCancelledError("Execution cancelled by user")

        # Check if notebook exists
        if not os.path.exists(notebook_path):
            raise FileNotFoundError(f"Notebook not found: {notebook_path}")

        await send_output(job_id, "🚀 Starting real-time notebook execution...")
        await send_output(job_id, f"📁 Loading notebook: {notebook_path}")

        # Load the notebook
        nb = nbformat.read(notebook_path, as_version=4)

        # Modify notebook to use custom files if provided
        if bpmn_path or xes_path:
            await send_output(job_id, "🔧 Configuring notebook for custom files...")
            if bpmn_path:
                await send_output(job_id, f"📋 Using BPMN model: {os.path.basename(bpmn_path)}")
                await send_output(job_id, f"📂 BPMN path: {bpmn_path}")
            if xes_path:
                await send_output(job_id, f"📊 Using event log: {os.path.basename(xes_path)}")
                await send_output(job_id, f"📂 Log path: {xes_path}")

            # Count cells before modification
            original_cells_with_paths = 0
            for cell in nb.cells:
                if cell.cell_type == "code":
                    if (
                        "bpmn_path" in cell.source
                        or "file_path" in cell.source
                        or ".bpmn" in cell.source
                        or ".xes" in cell.source
                        or ".csv" in cell.source
                    ):
                        original_cells_with_paths += 1

            await send_output(job_id, f"🔍 Found {original_cells_with_paths} cells with file references")
            nb = modify_notebook_for_custom_files(nb, bpmn_path, xes_path)
            await send_output(job_id, "✅ Notebook configured with custom file paths")

        code_cells = [c for c in nb.cells if c.cell_type == "code" and c.source.strip()]
        await send_output(job_id, f"📋 Found {len(code_cells)} code cells to execute")

        # Execute notebook cell by cell with real-time streaming
        await execute_notebook_realtime(job_id, nb)

        state.jobs[job_id]["status"] = "completed"
        await send_output(job_id, "✅ Notebook execution completed successfully!")
        if job_id in state.connections:
            await state.connections[job_id].send_json(
                {
                    "event": "completed",
                    "message": "Notebook execution finished",
                }
            )

    except PipelineCancelledError:
        state.jobs[job_id]["status"] = "cancelled"
        cancel_msg = "🛑 Notebook execution cancelled by user"
        state.jobs[job_id]["output"].append(cancel_msg)
        await send_output(job_id, cancel_msg)

        # if job_id in state.connections:
        #     await state.connections[job_id].send_json(
        #         {
        #             "event": "cancelled",
        #             "message": cancel_msg,
        #         }
        #     )

    except Exception as e:
        state.jobs[job_id]["status"] = "failed"
        error_msg = f"❌ Notebook execution failed: {e}"
        state.jobs[job_id]["output"].append(error_msg)

        # If it's a dependency error, provide helpful guidance
        if "No module named" in str(e):
            await send_output(job_id, "")
            await send_output(job_id, "💡 Missing Python dependencies detected!")
            await send_output(job_id, "📋 The notebook is running in a different Python environment.")
            await send_output(job_id, "📋 Please ensure the virtual environment has all required packages installed.")
            await send_output(job_id, "")
        if job_id in state.connections:
            await state.connections[job_id].send_json(
                {
                    "event": "error",
                    "message": error_msg,
                }
            )
    finally:
        # Cleanup cancellation flag for finished jobs.
        state.job_cancellations.pop(job_id, None)


def modify_notebook_for_custom_files(nb, bpmn_path: str = None, xes_path: str = None):
    """
    Modify notebook cells to use custom file paths instead of hardcoded ones.
    """
    if not bpmn_path and not xes_path:
        return nb  # No modifications needed

    for cell in nb.cells:
        if cell.cell_type == "code":
            source = cell.source

            # Replace BPMN file path (look for specific patterns in the notebook)
            if bpmn_path:
                # Convert Windows path to Unix-style for Python
                unix_bpmn_path = bpmn_path.replace(os.sep, "/")

                # Replace the specific hardcoded BPMN path in the notebook
                bpmn_patterns = [
                    (r'(?m)^(?!\s*#)\s*bpmn_path\s*=\s*["\'][^"\']*["\']', f'bpmn_path = "{unix_bpmn_path}"'),
                    (r'bpmn_path\s*=\s*["\'][^"\']*\.bpmn["\']', f'bpmn_path = "{unix_bpmn_path}"'),
                    (r'["\'][^"\']*dscp-ajuste-direto-simplificado.*\.bpmn["\']', f'"{unix_bpmn_path}"'),
                ]

                for pattern, replacement in bpmn_patterns:
                    if re.search(pattern, source):
                        source = re.sub(pattern, replacement, source)

            # Replace XES/CSV file path
            if xes_path:
                # Convert Windows path to Unix-style for Python
                unix_xes_path = xes_path.replace(os.sep, "/")

                # Replace the specific hardcoded log paths in the notebook
                # Be careful not to replace XSD files or other XML files
                xes_patterns = [
                    (r'(?m)^(?!\s*#)\s*file_path\s*=\s*["\'][^"\']*["\']', f'file_path = "{unix_xes_path}"'),
                    (r'file_path\s*=\s*["\'][^"\']*\.(xes|csv)["\']', f'file_path = "{unix_xes_path}"'),
                    (r'["\'][^"\']*piabs-abaixo-5000.*\.(xes|csv)["\']', f'"{unix_xes_path}"'),
                ]

                for pattern, replacement in xes_patterns:
                    if re.search(pattern, source):
                        source = re.sub(pattern, replacement, source)

            cell.source = source

    return nb


async def extract_analysis_variables(job_id: str, kc):
    """Extract key analysis variables from the kernel namespace and store them."""
    try:
        await send_output(job_id, "📊 Extracting analysis results...")

        # List of variables to extract
        variables_to_extract = [
            "performance_metrics",
            "frequency_metrics",
            "alignments_metrics",
            "conformance_metrics",
            "helper_variables",
        ]

        results = {}

        for var_name in variables_to_extract:
            try:
                # Execute code to get the variable value
                extraction_code = f"""
                    import json
                    import pickle
                    import numpy as np
                    import pandas as pd

                    def serialize_variable(var_name):
                        if var_name not in globals():
                            return None

                        value = globals()[var_name]

                        # Handle different data types
                        if isinstance(value, dict):
                            # For dictionaries, try to make them JSON serializable
                            try:
                                json.dumps(value)  # Test if already serializable
                                return value
                            except:
                                # Convert numpy types to native Python types
                                def convert_numpy(obj):
                                    if isinstance(obj, np.integer):
                                        return int(obj)
                                    elif isinstance(obj, np.floating):
                                        return float(obj)
                                    elif isinstance(obj, np.ndarray):
                                        return obj.tolist()
                                    elif isinstance(obj, dict):
                                        return {{k: convert_numpy(v) for k, v in obj.items()}}
                                    elif isinstance(obj, list):
                                        return [convert_numpy(v) for v in obj]
                                    return obj
                                return convert_numpy(value)
                        elif isinstance(value, pd.DataFrame):
                            return value.to_dict('records')
                        elif isinstance(value, (int, float, str, bool, list)):
                            return value
                        elif isinstance(value, np.number):
                            return value.item()
                        else:
                            # For complex objects, return a string representation
                            return str(value)

                    result = serialize_variable('{var_name}')
                    print(f"__RESULT_START__{var_name}__")
                    print(json.dumps(result) if result is not None else "null")
                    print(f"__RESULT_END__{var_name}__")
                    """

                msg_id = kc.execute(extraction_code)

                # Collect the output
                output_lines = []
                max_wait = 30  # 30 seconds max for variable extraction
                start_time = asyncio.get_event_loop().time()

                while True:
                    if asyncio.get_event_loop().time() - start_time > max_wait:
                        break

                    try:
                        msg = kc.get_iopub_msg(timeout=1)
                        if msg["parent_header"].get("msg_id") != msg_id:
                            continue

                        if msg["header"]["msg_type"] == "stream":
                            output_lines.append(msg["content"]["text"])
                        elif msg["header"]["msg_type"] == "status" and msg["content"]["execution_state"] == "idle":
                            break
                    except Exception:
                        continue

                # Parse the result from output
                full_output = "".join(output_lines)
                start_marker = f"__RESULT_START__{var_name}__"
                end_marker = f"__RESULT_END__{var_name}__"

                if start_marker in full_output and end_marker in full_output:
                    start_idx = full_output.find(start_marker) + len(start_marker)
                    end_idx = full_output.find(end_marker)
                    json_str = full_output[start_idx:end_idx].strip()

                    if json_str and json_str != "null":
                        import json

                        results[var_name] = json.loads(json_str)

            except Exception as e:
                await send_output(job_id, f"⚠️ Could not extract {var_name}: {str(e)}")
                continue

        # Store the results
        state.analysis_results[job_id] = results

        # Log what was successfully extracted
        extracted_vars = list(results.keys())
        if extracted_vars:
            await send_output(job_id, f"✅ Extracted variables: {', '.join(extracted_vars)}")
        else:
            await send_output(job_id, "⚠️ No variables could be extracted")

    except Exception as e:
        await send_output(job_id, f"❌ Error extracting variables: {str(e)}")


async def execute_notebook_realtime(job_id: str, nb):
    """Execute notebook cells one by one and stream outputs in real-time."""
    if state.job_cancellations.get(job_id):
        raise PipelineCancelledError("Execution cancelled by user")

    await send_output(job_id, "🔌 Getting kernel (cached imports)...")

    # Count total code cells for progress tracking
    code_cells = [cell for cell in nb.cells if cell.cell_type == "code" and cell.source.strip()]
    total_cells = len(code_cells)
    completed_cells = 0

    await send_output(job_id, f"📊 Total cells to execute: {total_cells}")

    if state.job_cancellations.get(job_id):
        raise PipelineCancelledError("Execution cancelled by user")

    # Get or create persistent kernel (with cached imports)
    _km, kc = await get_or_create_kernel()

    if state.job_cancellations.get(job_id):
        raise PipelineCancelledError("Execution cancelled by user")

    # Reset namespace from previous analysis (but keep imports)
    await send_output(job_id, "🧹 Resetting namespace (preserving imports)...")
    await reset_kernel_namespace()

    if state.job_cancellations.get(job_id):
        raise PipelineCancelledError("Execution cancelled by user")

    try:
        cell_index = 0

        for cell in nb.cells:
            if state.job_cancellations.get(job_id):
                raise PipelineCancelledError("Execution cancelled by user")

            if cell.cell_type == "markdown":
                continue
            if cell.cell_type == "code":
                code = cell.source.strip()

                if not code:
                    continue

                cell_index += 1
                progress = {
                    "current_cell": cell_index,
                    "total_cells": total_cells,
                    "percentage": round((completed_cells / total_cells) * 100, 1),
                }

                # Execute the cell
                msg_id = kc.execute(code)

                # Collect outputs in real-time
                await collect_cell_outputs(job_id, kc, msg_id, progress)

                # Update progress after cell completion
                completed_cells += 1
                await asyncio.sleep(0.5)  # Small delay between cells

        # Extract analysis variables after all cells are executed
        await extract_analysis_variables(job_id, kc)

    finally:
        # Keep kernel process alive for reuse without emitting extra UI noise.
        pass


async def collect_cell_outputs(job_id: str, kc, msg_id, progress: dict = None):
    """Collect and stream outputs from a single cell execution."""
    max_wait_time = 300  # 5 minutes max per cell
    start_time = asyncio.get_event_loop().time()

    # Track mapping detection
    awaiting_mapping_confirmation = False
    mapping_lines = {"suggested": [], "non_suggested": []}
    current_section = None

    while True:
        try:
            if state.job_cancellations.get(job_id):
                raise PipelineCancelledError("Execution cancelled by user")

            # Check if we've exceeded max wait time
            if asyncio.get_event_loop().time() - start_time > max_wait_time:
                await send_output(job_id, "⏰ Cell execution timeout - moving to next cell", progress)
                break

            # Get message with a short timeout
            msg = kc.get_iopub_msg(timeout=1)

            if msg["parent_header"].get("msg_id") != msg_id:
                continue

            msg_type = msg["header"]["msg_type"]
            content = msg["content"]

            if msg_type == "stream":
                # stdout/stderr output
                text = content["text"].strip()
                if text:
                    for line in text.split("\n"):
                        if line.strip():
                            # Detect AI-based fuzzy mapping completion
                            if "AI-based fuzzy mapping complete" in line:
                                awaiting_mapping_confirmation = True

                            # Detect mapping sections
                            if "Suggested Mappings" in line and "✅" in line:
                                current_section = "suggested"
                            elif "Non Suggested Mappings" in line and "❌" in line:
                                current_section = "non_suggested"
                            elif "All labels match perfectly" in line:
                                current_section = None
                                awaiting_mapping_confirmation = False

                            # Collect mapping lines (lines with →)
                            if current_section and "→" in line:
                                # Non-suggested mappings have ❌ emoji in the line itself
                                if "❌" in line:
                                    # Remove the ❌ prefix for cleaner display
                                    clean_line = line.replace("❌", "").strip()
                                    mapping_lines["non_suggested"].append(clean_line)
                                else:
                                    # Suggested mappings don't have the emoji in the line
                                    mapping_lines["suggested"].append(line.strip())

                            await send_output(job_id, line, progress)
                            state.jobs[job_id]["output"].append(line)
                            await asyncio.sleep(0.05)  # Small delay for readability

            elif msg_type == "execute_result":
                # Result output (like print statements result)
                data = content.get("data", {})
                if "text/plain" in data:
                    text = data["text/plain"].strip()
                    if text:
                        for line in text.split("\n"):
                            if line.strip():
                                await send_output(job_id, line, progress)
                                state.jobs[job_id]["output"].append(line)
                                await asyncio.sleep(0.05)

            elif msg_type == "display_data":
                # Display output (plots, images, etc.)
                data = content.get("data", {})
                if "text/plain" in data:
                    text = data["text/plain"].strip()
                    if text:
                        await send_output(job_id, f"📊 Display: {text}", progress)
                elif "image/png" in data:
                    await send_output(job_id, "📊 Generated plot/visualization", progress)

            elif msg_type == "error":
                if state.job_cancellations.get(job_id):
                    raise PipelineCancelledError("Execution cancelled by user")

                # Fail fast on notebook errors; the outer handler emits one clean failure line.
                error_name = content["ename"]
                error_value = content["evalue"]
                raise RuntimeError(f"{error_name}: {error_value}")

            elif msg_type == "status":
                if content["execution_state"] == "idle":
                    # Cell execution finished
                    # Check if we need to wait for mapping confirmation
                    if awaiting_mapping_confirmation and (mapping_lines["suggested"] or mapping_lines["non_suggested"]):
                        await send_output(job_id, "⏸️ Waiting for mapping approval...", progress)

                        # Extract activity lists for manual mapping
                        bpmn_activities = []
                        log_activities = []

                        try:
                            # Get variable names from variables_manual_mappings
                            extraction_code = """
                                import json
                                variable_names = globals().get('variables_manual_mappings', [])
                                result = {}
                                for var_name in variable_names:
                                    if var_name in globals():
                                        result[var_name] = globals()[var_name]
                                json.dumps(result, ensure_ascii=False)
                            """
                            mapping_extract_msg_id = kc.execute(extraction_code)

                            # Wait for result
                            while True:
                                try:
                                    mapping_msg = kc.get_iopub_msg(timeout=5)
                                    if mapping_msg["parent_header"].get("msg_id") == mapping_extract_msg_id:
                                        if mapping_msg["msg_type"] == "execute_result":
                                            data = mapping_msg["content"]["data"].get("text/plain", "")
                                            data = data.strip().strip("'\"")
                                            import json

                                            extracted = json.loads(data)

                                            # Get the activity lists
                                            for key, value in extracted.items():
                                                if "bpmn" in key.lower():
                                                    bpmn_activities = value
                                                elif "log" in key.lower():
                                                    log_activities = value
                                            break
                                        if mapping_msg["msg_type"] == "error":
                                            break
                                except queue.Empty:
                                    break
                        except Exception as e:
                            await send_output(job_id, f"⚠️ Could not extract activity lists: {e}", progress)

                        # Send mapping data to frontend with activity lists
                        if job_id in state.connections:
                            await state.connections[job_id].send_json(
                                {
                                    "event": "mapping_approval_required",
                                    "mappings_suggested": mapping_lines["suggested"],
                                    "mappings_non_suggested": mapping_lines["non_suggested"],
                                    "bpmn_activities": bpmn_activities,
                                    "log_activities": log_activities,
                                }
                            )

                        # Create and wait for confirmation event
                        state.mapping_confirmations[job_id] = asyncio.Event()
                        await state.mapping_confirmations[job_id].wait()

                        if state.job_cancellations.get(job_id):
                            state.mapping_confirmations.pop(job_id, None)
                            raise PipelineCancelledError("Execution cancelled by user")

                        # Inject user-confirmed mappings into kernel namespace
                        if job_id in state.user_confirmed_mappings:
                            mappings = state.user_confirmed_mappings[job_id]
                            await send_output(
                                job_id,
                                f"💉 Injecting {len(mappings)} user-confirmed mappings into kernel...",
                                progress,
                            )

                            # Create a Python dict from the mappings
                            mappings_dict_code = "user_confirmed_mappings = {\n"
                            for mapping in mappings:
                                log_label = mapping["log"].replace("'", "\\'")
                                model_label = mapping["model"].replace("'", "\\'")
                                mappings_dict_code += f"    '{log_label}': '{model_label}',\n"
                            mappings_dict_code += "}\n"
                            mappings_dict_code += f"print('✅ Loaded {len(mappings)} user-confirmed mappings')\n"

                            # Execute the code to inject mappings
                            inject_msg_id = kc.execute(mappings_dict_code)

                            # Wait for injection to complete
                            max_wait = 5
                            start_inject = asyncio.get_event_loop().time()
                            while True:
                                if asyncio.get_event_loop().time() - start_inject > max_wait:
                                    break
                                try:
                                    inject_msg = kc.get_iopub_msg(timeout=1)
                                    if inject_msg["parent_header"].get("msg_id") != inject_msg_id:
                                        continue
                                    if (
                                        inject_msg["header"]["msg_type"] == "status"
                                        and inject_msg["content"]["execution_state"] == "idle"
                                    ):
                                        break
                                except Exception:
                                    continue

                            await send_output(job_id, "✅ User-confirmed mappings injected successfully", progress)

                        # Clean up
                        state.mapping_confirmations.pop(job_id, None)
                        if job_id in state.user_confirmed_mappings:
                            del state.user_confirmed_mappings[job_id]
                        await send_output(job_id, "▶️ Continuing execution...", progress)

                    break

        except queue.Empty:
            # No more messages, continue waiting
            continue
        except Exception:
            # Propagate the exception so the run is marked as failed and stops.
            raise
