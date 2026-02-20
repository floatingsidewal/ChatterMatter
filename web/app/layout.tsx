import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChatterMatter",
  description:
    "Track changes and comments for Markdown — portable, AI-native, and independent of any platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
