# SELENIC Vercel backend startup fix

This patch makes the FastAPI entrypoint explicit for a Vercel project with Root Directory `backend`, pins the Python runtime to 3.12, and imports Rasterio/GDAL/PyProj lazily inside the DEM routes.

Why: if a native geospatial library cannot be loaded in the Vercel runtime, it should not prevent `/api/health`, Horizons comparison, visibility, or mission simulation from starting. DEM endpoints return HTTP 503 with a clear message instead. The Vercel runtime logs will contain the import traceback.

## Files changed

- `backend/pyproject.toml`: `app.main:app` explicit Vercel entrypoint.
- `backend/.python-version`: Python 3.12.
- `backend/app/main.py`: lazy geospatial imports and logged diagnostics in both terrain endpoints.

## Deploy

Keep the Vercel backend project's Root Directory set to `backend`. Commit and push these files to the `main` branch. Vercel should automatically create a new production deployment.

After deployment, test `https://selenic-api.vercel.app/api/health`. If it succeeds, update the backend project's `SELENIC_CORS_ORIGINS` to the exact frontend origin, e.g. `https://selenic.vercel.app`, and redeploy. The frontend project's `VITE_API_BASE_URL` should be `https://selenic-api.vercel.app` (no `/api` suffix), followed by a frontend redeployment.

This patch isolates common native-geospatial startup failures; it does not assert that the underlying GDAL/Rasterio runtime is compatible. If the terrain endpoints return 503, inspect the new runtime log message for the specific import error.
