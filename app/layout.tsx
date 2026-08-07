import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Bus Kahan Hai? | Karachi People’s Bus Tracker";
  const description = "Find Karachi People’s Bus routes, stops and available live vehicle locations in one lightweight mobile tracker.";
  return {
    title,
    description,
    icons: { icon: "/brand/app-icon.png", shortcut: "/brand/app-icon.png", apple: "/brand/app-icon.png" },
    openGraph: { title, description, type: "website", images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "Bus Kahan Hai, Karachi People’s Bus tracker" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const socialProfiles = [
    "https://instagram.com/buskahanhai",
    "https://facebook.com/buskahanhai",
    "https://linkedin.com/company/buskahanhai",
    "https://youtube.com/@buskahanhai",
    "https://tiktok.com/@buskahanhai",
    "https://x.com/buskahanhai",
    "https://threads.net/@buskahanhai",
    "https://t.me/buskahanhai",
  ];
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Bus Kahan Hai?",
    url: "https://buskahanhai.com",
    applicationCategory: "TravelApplication",
    description: "Find Karachi People’s Bus routes, stops and available live vehicle locations.",
    sameAs: socialProfiles,
  };
  return <html lang="en"><body className={manrope.variable}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />{children}</body></html>;
}
