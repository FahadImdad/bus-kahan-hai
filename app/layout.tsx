import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Manrope } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const GA_MEASUREMENT_ID = "G-4CV2E4N8R8";

export const viewport: Viewport = {
  themeColor: "#073665",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

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
    applicationName: "Bus Kahan Hai?",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: "Bus Kahan Hai?", statusBarStyle: "default" },
    icons: {
      icon: [
        { url: "/favicon.png", type: "image/png" },
        { url: "/brand/icon-192.png", type: "image/png", sizes: "192x192" },
        { url: "/brand/icon-512.png", type: "image/png", sizes: "512x512" },
      ],
      shortcut: "/favicon.png",
      apple: [{ url: "/brand/icon-192.png", sizes: "192x192" }],
    },
    openGraph: { title, description, type: "website", siteName: "Bus Kahan Hai?", url: origin, locale: "en_PK", images: [{ url: `${origin}/og.jpg`, secureUrl: `${origin}/og.jpg`, width: 1200, height: 630, type: "image/jpeg", alt: "People’s Bus Karachi Live Tracking — buskahanhai.com" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.jpg`] },
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
  return <html lang="en"><body className={manrope.variable}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} /><Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} strategy="afterInteractive" /><Script id="gtag-init" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${GA_MEASUREMENT_ID}');` }} />{children}</body></html>;
}
