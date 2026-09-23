import os
import shutil
import uuid

from fastapi import APIRouter, BackgroundTasks, File, Form, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from core import state
from services.kernel_service import interrupt_kernel_execution
from services.notebook_service import run_notebook

router = APIRouter()

# === File upload directory ===
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _is_safe_upload_path(path: str) -> bool:
    """Allow cleanup only for files inside the configured upload directory."""
    upload_root = os.path.abspath(UPLOAD_DIR)
    resolved_path = os.path.abspath(path)
    return resolved_path == upload_root or resolved_path.startswith(upload_root + os.sep)


def cleanup_uploaded_files(job_id: str) -> None:
    """Remove uploaded files associated with a websocket/job session."""
    uploaded_paths = state.uploaded_files.pop(job_id, [])

    for path in uploaded_paths:
        if not path or not _is_safe_upload_path(path):
            continue

        try:
            if os.path.isfile(path):
                os.remove(path)
                print(f"🧹 Removed uploaded file for job {job_id}: {path}")
        except OSError as exc:
            print(f"⚠️ Failed to remove uploaded file for job {job_id}: {path} ({exc})")


def associate_uploaded_files(job_id: str, uploaded_paths: list[str]) -> None:
    """Associate uploaded files with the active run job and clear older aliases."""
    normalized_paths = [path for path in uploaded_paths if path]
    if not normalized_paths:
        return

    state.uploaded_files[job_id] = normalized_paths

    for existing_job_id, existing_paths in list(state.uploaded_files.items()):
        if existing_job_id == job_id:
            continue

        if set(existing_paths) == set(normalized_paths):
            state.uploaded_files.pop(existing_job_id, None)


@router.get("/")
async def root():
    return {"message": "🚀 FastAPI Real-time Notebook Runner is running!"}


@router.get("/server/connect")
async def connect_server():
    """
    Health/readiness endpoint.
    Returns ready only after startup warm-up completes.
    """
    if state.backend_ready:
        return JSONResponse(
            {
                "status": "connected",
                "ready": True,
                "message": "✅ Server is online and warmed up",
            }
        )

    return JSONResponse(
        {
            "status": "starting",
            "ready": False,
            "message": "⏳ Server is starting and warming up",
            "error": state.backend_startup_error,
        },
        status_code=503,
    )


@router.post("/upload")
async def upload_files(
    bpmn_file: UploadFile = File(...),
    xes_file: UploadFile = File(...),
):
    """
    Upload BPMN and XES files for conformance analysis.
    Returns file paths that can be used for analysis.
    """
    try:
        # Validate file extensions
        if not bpmn_file.filename.endswith(".bpmn"):
            return JSONResponse({"error": "BPMN file must have .bpmn extension"}, status_code=400)
        if not xes_file.filename.endswith((".xes", ".csv")):
            return JSONResponse({"error": "Log file must have .xes or .csv extension"}, status_code=400)

        # Generate unique filenames
        job_id = str(uuid.uuid4())
        bpmn_filename = f"{job_id}_model.bpmn"
        xes_filename = f"{job_id}_log{os.path.splitext(xes_file.filename)[1]}"

        # Save files
        bpmn_path = os.path.join(UPLOAD_DIR, bpmn_filename)
        xes_path = os.path.join(UPLOAD_DIR, xes_filename)

        with open(bpmn_path, "wb") as buffer:
            shutil.copyfileobj(bpmn_file.file, buffer)

        with open(xes_path, "wb") as buffer:
            shutil.copyfileobj(xes_file.file, buffer)

        state.uploaded_files[job_id] = [bpmn_path, xes_path]

        return JSONResponse(
            {
                "message": "Files uploaded successfully",
                "job_id": job_id,
                "bpmn_path": bpmn_path,
                "xes_path": xes_path,
                "bpmn_filename": bpmn_file.filename,
                "xes_filename": xes_file.filename,
            }
        )

    except Exception as e:
        return JSONResponse({"error": f"Upload failed: {str(e)}"}, status_code=500)


@router.post("/run")
async def start_notebook(
    background_tasks: BackgroundTasks,
    bpmn_path: str = Form(...),
    xes_path: str = Form(...),
):
    """
    Start executing the notebook asynchronously with optional custom file paths.
    Returns a unique job ID for tracking and WebSocket streaming.
    """
    job_id = str(uuid.uuid4())
    state.jobs[job_id] = {"status": "queued", "output": []}
    state.job_cancellations[job_id] = False
    associate_uploaded_files(job_id, [bpmn_path, xes_path])
    background_tasks.add_task(run_notebook, job_id, bpmn_path, xes_path)
    return JSONResponse({"job_id": job_id})


@router.post("/cancel/{job_id}")
async def cancel_notebook(job_id: str):
    """Request cancellation for a running/queued notebook job."""
    job = state.jobs.get(job_id)
    if not job:
        return JSONResponse({"error": "Invalid job ID"}, status_code=404)

    if job.get("status") in {"completed", "failed", "cancelled"}:
        return JSONResponse({"message": f"Job already {job.get('status')}"})

    state.job_cancellations[job_id] = True

    # Unblock mapping-approval wait if the job is paused there.
    if job_id in state.mapping_confirmations:
        state.mapping_confirmations[job_id].set()

    # Best-effort interrupt of currently running cell.
    await interrupt_kernel_execution()

    return JSONResponse({"message": "Cancellation requested", "job_id": job_id})


@router.get("/status/{job_id}")
async def get_status(job_id: str):
    """Return job status and accumulated output."""
    job = state.jobs.get(job_id)
    if not job:
        return JSONResponse({"error": "Invalid job ID"}, status_code=404)
    return JSONResponse(job)


@router.get("/results/{job_id}")
async def get_analysis_results(job_id: str):
    """Return analysis results for a completed job."""
    if job_id not in state.jobs:
        return JSONResponse({"error": "Invalid job ID"}, status_code=404)

    if state.jobs[job_id]["status"] != "completed":
        return JSONResponse({"error": "Job not completed yet"}, status_code=400)

    results = state.analysis_results.get(job_id, {})
    if not results:
        return JSONResponse({"error": "No analysis results available for this job"}, status_code=404)

    return JSONResponse(results)


@router.post("/confirm-mappings/{job_id}")
async def confirm_mappings(job_id: str, request: Request):
    """
    Confirm that the user has reviewed AI fuzzy mappings and wants to continue.
    Receives selected mappings from the frontend.
    """
    if job_id not in state.jobs:
        return JSONResponse({"error": "Invalid job ID"}, status_code=404)

    if job_id not in state.mapping_confirmations:
        return JSONResponse({"error": "No mapping confirmation pending for this job"}, status_code=400)

    def validate_mappings(mappings):
        errors = []

        if not isinstance(mappings, list):
            return ["Mappings payload must be a list."]

        if len(mappings) == 0:
            return errors

        log_to_models = {}

        for idx, mapping in enumerate(mappings):
            if not isinstance(mapping, dict):
                errors.append(f"Mapping #{idx + 1} is not an object.")
                continue

            if "log" not in mapping or "model" not in mapping:
                errors.append(f"Mapping #{idx + 1} must include 'log' and 'model'.")
                continue

            log_label = mapping["log"]
            model_label = mapping["model"]

            if not isinstance(log_label, str) or not isinstance(model_label, str):
                errors.append(f"Mapping #{idx + 1} fields must be strings.")
                continue

            if log_label not in log_to_models:
                log_to_models[log_label] = []
            log_to_models[log_label].append(model_label)

        for log_label, models in log_to_models.items():
            if len(models) > 1:
                unique_models = set(models)
                if len(unique_models) > 1:
                    models_list = " and ".join([f"\"{model}\"" for model in unique_models])
                    errors.append(
                        f"Log label \"{log_label}\" maps to multiple model labels ({models_list})."
                    )
                else:
                    errors.append(
                        f"Log label \"{log_label}\" is mapped multiple times to \"{models[0]}\"."
                    )

        return errors

    # Parse the request body to get the mappings
    try:
        body = await request.json()
    except Exception as e:
        return JSONResponse({"error": f"Invalid JSON body: {e}"}, status_code=400)

    mappings = body.get("mappings", [])
    errors = validate_mappings(mappings)

    if errors:
        error_message = "Mapping validation failed: " + "; ".join(errors)

        # Stop execution and unblock the waiting notebook cell.
        state.job_cancellations[job_id] = True
        if job_id in state.mapping_confirmations:
            state.mapping_confirmations[job_id].set()

        if job_id in state.connections:
            await state.connections[job_id].send_json(
                {
                    "event": "error",
                    "message": error_message,
                }
            )

        return JSONResponse({"error": error_message, "details": errors}, status_code=400)

    print(f"\n📋 Received {len(mappings)} mappings for job {job_id}:")
    for mapping in mappings:
        print(f"  • {mapping['log']} → {mapping['model']}")
    print()

    # Store the mappings for use in notebook execution
    state.user_confirmed_mappings[job_id] = mappings

    # Signal the event to continue execution
    state.mapping_confirmations[job_id].set()

    return JSONResponse({"message": "Mappings confirmed, execution will continue"})


@router.websocket("/ws/{job_id}")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    """Provide live notebook output streaming over WebSocket."""
    if not state.backend_ready:
        await websocket.close(code=1013, reason="Backend warming up")
        return

    await websocket.accept()
    state.connections[job_id] = websocket

    try:
        # Send previous output if reconnecting
        if job_id in state.jobs:
            for msg in state.jobs[job_id]["output"]:
                await websocket.send_json({"event": "cell_output", "message": msg})

        while True:
            data = await websocket.receive_text()
            if data.lower() == "close":
                await websocket.close()
                break
    except WebSocketDisconnect:
        pass
    finally:
        state.connections.pop(job_id, None)

        job = state.jobs.get(job_id)
        if job and job.get("status") not in {"completed", "failed", "cancelled"}:
            state.job_cancellations[job_id] = True

            if job_id in state.mapping_confirmations:
                state.mapping_confirmations[job_id].set()

            await interrupt_kernel_execution()

        cleanup_uploaded_files(job_id)
