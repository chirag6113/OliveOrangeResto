# Olive & Orange Resto

Olive & Orange Resto is a restaurant ordering and management app. The frontend is a React application, and the backend is a FastAPI service.

## Run the frontend

```powershell
cd frontend
npm install
npm start
```

Set `REACT_APP_BACKEND_URL` in `frontend/.env` to the backend base URL before starting the frontend. For example, use `http://localhost:8000` when running the API locally.

## Run the backend

```powershell
cd backend
python -m pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8000
```

The backend requires `MONGO_URL`. Set `CORS_ORIGINS` to a comma-separated list of frontend origins allowed to call the API.

## Deployment

Deploy the frontend and backend as separate services. Configure the frontend's `REACT_APP_BACKEND_URL` with the public backend URL, and configure the backend's database and allowed frontend origins in its environment.
