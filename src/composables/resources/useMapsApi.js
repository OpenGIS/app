import { api, ensureCsrfCookie } from "@/api/client";

const serializeGeoJSON = (value) =>
  typeof value === "string" ? value : JSON.stringify(value);

export function useMapsApi() {
  const list = () => api.get("/api/user/maps");
  const show = (id) => api.get(`/api/user/maps/${id}`);

  const create = async (payload) => {
    await ensureCsrfCookie();

    return api.post("/api/user/maps", {
      ...payload,
      geojson: serializeGeoJSON(payload.geojson),
    });
  };

  const update = async (id, payload) => {
    await ensureCsrfCookie();

    return api.put(`/api/user/maps/${id}`, {
      ...payload,
      geojson: serializeGeoJSON(payload.geojson),
    });
  };

  const destroy = async (id) => {
    await ensureCsrfCookie();
    return api.delete(`/api/user/maps/${id}`);
  };

  return {
    list,
    show,
    create,
    update,
    destroy,
  };
}
