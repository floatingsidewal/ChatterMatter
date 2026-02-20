import type { Metadata } from "next";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { NavBar } from "@/components/NavBar";

export const metadata: Metadata = {
  title: "ChatterMatter",
  description: "Track changes and comments for Markdown",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 min-h-screen flex flex-col">
        <StoreProvider>
          <NavBar />
          <main className="flex-1">{children}</main>
        </StoreProvider>
      </body>
    </html>
  );
}
