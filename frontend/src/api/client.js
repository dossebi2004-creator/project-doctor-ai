import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach the stored JWT (if any) to every outgoing request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pda_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Normalize backend error shape ({ success: false, error: { message } })
// into a plain Error so components can just do `catch (err) { err.message }`.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const message = err.response?.data?.error?.message || err.message || 'Something went wrong';
    const details = err.response?.data?.error?.details;
    const normalized = new Error(message);
    normalized.details = details;
    normalized.status = err.response?.status;
    return Promise.reject(normalized);
  }
);

export default api;
