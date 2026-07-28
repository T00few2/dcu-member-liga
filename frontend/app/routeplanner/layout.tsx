import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Route Planner",
  description: "Plan Zwift race routes: pick a map and route, and estimate lap counts and finish times per category.",
  openGraph: {
    title: "Route Planner – DCU E-serien",
    description: "Plan Zwift race routes: pick a map and route, and estimate lap counts and finish times per category.",
    url: "/routeplanner",
  },
};

export default function RoutePlannerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
