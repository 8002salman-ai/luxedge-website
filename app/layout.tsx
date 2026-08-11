import type { Metadata, Viewport } from "next";
import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://luxedge.us"),
  title: { default: "LuxEdge | Better days with your best friend", template: "%s | LuxEdge" },
  description: "Thoughtfully selected pet essentials, verified for quality, delivery and everyday usefulness.",
  openGraph: { title: "LuxEdge | Better days with your best friend", description: "Pet essentials selected with care, clarity and zero clutter.", siteName: "LuxEdge", type: "website", images: [{ url: "/og.png", width: 1728, height: 912, alt: "LuxEdge — Better days with your best friend." }] },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export const viewport: Viewport = { themeColor: "#171713", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" style={{ "--font-display": '"Iowan Old Style", "Palatino Linotype", Georgia', "--font-body": 'Inter, Manrope, "Segoe UI", Arial' } as React.CSSProperties}><body><Header /><main>{children}</main><Footer /></body></html>;
}
