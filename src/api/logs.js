const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

async function apiFetch(path, options = {}) {
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
    });
    const json = await response.json();
    if (!response.ok) return { data: null, error: json.message || "Request failed" };
    return { data: json.data ?? json, error: null };
  } catch (err) {
    return { data: null, error: "Cannot reach server" };
  }
}

export async function getLog(date) {
  const { data, error } = await apiFetch(`/logs/${date}`);
  if (error === "No log found for this date") return { data: null, error: null };
  return { data, error };
}

export async function getAllLogs() {
  return apiFetch("/logs");
}

export async function saveLog(date, logData) {
  return apiFetch(`/logs/${date}`, {
    method: "PUT",
    body: JSON.stringify({ date, ...logData }),
  });
}

export async function getStreak() {
  const { data, error } = await apiFetch("/logs/streak");
  return { streak: data?.streak ?? 0, error };
}
