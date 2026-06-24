# Iminationz POS — DEPRECATED backend stub
#
# The application has migrated to Expo + Supabase (see /app/supabase/).
# This file exists only because the platform's supervisor still launches
# a uvicorn process; it intentionally exposes no routes. All data and
# business logic now lives in Supabase Postgres + the supabase-js client
# in the Expo app.
#
# Do not add code here. If you need to reverse the migration, restore
# this file from git history (commit prior to the Supabase migration).

from fastapi import FastAPI

app = FastAPI(title="Iminationz POS (decommissioned)")


@app.get("/api/")
async def root():
    return {
        "status": "decommissioned",
        "message": "This backend has been removed. App now runs on Expo + Supabase.",
    }
