import { createFileRoute } from "@tanstack/react-router";
import { corsPreflight, handlePosApi } from "@/lib/pos/api-handler";

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      OPTIONS: () => corsPreflight(),
      GET: ({ request, params }) => handlePosApi(request, params._splat ?? ""),
      POST: ({ request, params }) => handlePosApi(request, params._splat ?? ""),
      PATCH: ({ request, params }) => handlePosApi(request, params._splat ?? ""),
    },
  },
});
