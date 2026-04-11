import type { Metadata, Viewport } from "next";
import {
  WAKA_ROOT_METADATA_CONFIG,
  WAKA_ROOT_VIEWPORT_CONFIG,
} from "../src/pwa/root-metadata.ts";
import { ServiceWorkerRegistration } from "../src/pwa/service-worker-registration-client.tsx";
import "./globals.css";

export const viewport: Viewport = WAKA_ROOT_VIEWPORT_CONFIG;

export const metadata: Metadata = WAKA_ROOT_METADATA_CONFIG;

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className="h-full bg-stone-950">
      <body className="min-h-screen w-full max-w-full overflow-x-hidden bg-stone-950 text-stone-50 antialiased">
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
