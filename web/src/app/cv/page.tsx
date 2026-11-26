import { CvTabs } from "@/components/cv/cv-tabs";

export const dynamic = "force-dynamic";

const TAB_PARAM: Record<string, "cv" | "data" | "profile"> = {
  data: "data",
  profile: "profile",
};

export default async function CvPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  // `?tab=data` / `?tab=profile` are the shareable, back-button-friendly form of
  // a tab that otherwise lives in client state.
  const { tab } = await searchParams;
  return <CvTabs initialTab={(tab && TAB_PARAM[tab]) || "cv"} />;
}
