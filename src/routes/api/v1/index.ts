import { createFileRoute } from "@tanstack/react-router";
import { corsPreflight, handlePosApi } from "@/lib/pos/api-handler";

export const Route = createFileRoute("/api/v1/")({
  server: {
    handlers: {
      OPTIONS: () => corsPreflight(),
      GET: ({ request }) => handlePosApi(request, "health"),
    },
  },
});
