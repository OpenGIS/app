import { api, ensureCsrfCookie } from "@/api/client";

const withParentId = (payload) => ({
  ...payload,
  parent_id: payload.parent_id ?? null,
});

export function useCollectionsApi() {
  const list = () => api.get("/api/user/collections");
  const show = (id) => api.get(`/api/user/collections/${id}`);

  const create = async (payload) => {
    await ensureCsrfCookie();
    return api.post("/api/user/collections", withParentId(payload));
  };

  const update = async (id, payload) => {
    await ensureCsrfCookie();
    return api.put(`/api/user/collections/${id}`, withParentId(payload));
  };

  const destroy = async (id) => {
    await ensureCsrfCookie();
    return api.delete(`/api/user/collections/${id}`);
  };

  return {
    list,
    show,
    create,
    update,
    destroy,
  };
}
