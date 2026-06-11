import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/boloes")({
  component: () => <Outlet />,
});
