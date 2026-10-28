import { CvTabs } from "@/components/cv/cv-tabs";

export const dynamic = "force-dynamic";

export default async function CvPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  // `?tab=data` is the shareable/back-button-friendly form of the second tab.
  const { tab } = await searchParams;
  return <CvTabs initialTab={tab === "data" ? "data" : "cv"} />;
}
