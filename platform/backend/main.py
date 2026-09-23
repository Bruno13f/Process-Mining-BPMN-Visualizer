import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router as api_router
from core import state
from services.kernel_service import get_or_create_kernel

# Load environment variables from .env
load_dotenv()

app = FastAPI(title="📒 Real-time Notebook Execution Server")

# Get FRONTEND_URL from environment or use default
FRONTEND_URL = os.getenv("FRONTEND_URL")

# Add CORS middleware with dynamic origin from environment
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def warmup_on_startup():
    """
    Strict startup sequence: block startup until kernel warm-up is complete.
    The app is considered ready only after this finishes successfully.
    """
    state.backend_ready = False
    state.backend_startup_error = None

    try:
        print("🚀 Backend startup: warming up kernel...")
        await get_or_create_kernel()
        state.backend_ready = True
        print("✅ Backend startup: kernel warm-up complete. Server is ready.")
    except Exception as e:
        state.backend_startup_error = str(e)
        print(f"❌ Backend startup warm-up failed: {e}")
        # Strict behavior: do not finish startup if warm-up fails.
        raise


app.include_router(api_router)
